import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { createHash } from "node:crypto";
import {
  entity,
  type Application,
  type CandidateProfile,
  type GeneratedResume,
  type ScreeningAnswer,
  type Stage,
} from "./contracts";
import { JobError, isFixtureUrl, selectScreeningAnswer, validateJobUrl } from "./jobs";
import { getStore } from "./store";
import { readArtifact, writeArtifact } from "./storage";

export type BrowserQuestion = { key: string; label: string; options?: string[] };
export type FormReview = {
  fields: Record<string, string>;
  answerContexts: Record<string, string>;
  formSnapshotHash: string;
};
export type BrowserOutcome =
  | ({ kind: "prepared" } & FormReview)
  | {
      kind: "needs_input";
      questions: BrowserQuestion[];
      message: string;
      login?: boolean;
      sessionId?: string;
    }
  | { kind: "submitted"; confirmation: string; url: string; screenshotKey?: string }
  | { kind: "unverified"; message: string };
type BrowserHandle = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  sessionId?: string;
  close: (keepAlive?: boolean) => Promise<void>;
};

const MAX_BROWSER_MS = Number(process.env.MAX_BROWSER_RUNTIME_MS || 180000);
const safeValue = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

export function browserDomainAllowed(url: string): boolean {
  if (isFixtureUrl(url)) return true;
  const allowed = (process.env.BROWSER_ALLOWED_DOMAINS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(new URL(url).hostname.toLowerCase());
}

async function browserbaseRequest(
  path: string,
  body?: Record<string, unknown>,
  method?: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.browserbase.com/v1/${path}`, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      "X-BB-API-Key": process.env.BROWSERBASE_API_KEY || "",
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new JobError(
      `Browserbase returned HTTP ${response.status}. Check worker configuration.`,
      "browser_configuration",
    );
  return safeValue(await response.json());
}

async function openBrowser(
  userId: string,
  url: string,
  resumeSessionId?: string,
): Promise<BrowserHandle> {
  if (!browserDomainAllowed(url))
    throw new JobError(
      "Browser execution is not enabled for this employer domain. An operator must confirm permitted automation and add it to BROWSER_ALLOWED_DOMAINS.",
      "domain_not_enabled",
    );
  const start = await validateJobUrl(url);
  let browser: Browser, context: BrowserContext, sessionId: string | undefined;
  if (process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID && !isFixtureUrl(url)) {
    const provider = `browserbase:${start.hostname}`;
    const connections = await getStore().list("integration_connections", userId);
    let connection = connections.find((c) => c.provider === provider && c.status === "connected");
    if (!connection) {
      const created = await browserbaseRequest("contexts", {
        projectId: process.env.BROWSERBASE_PROJECT_ID,
        name: `career-${createHash("sha256").update(`${userId}:${start.hostname}`).digest("hex").slice(0, 28)}`,
      });
      if (typeof created.id !== "string")
        throw new JobError(
          "Browserbase did not return a context identifier.",
          "browser_configuration",
        );
      connection = await getStore().save("integration_connections", {
        ...entity(userId),
        provider,
        status: "connected",
        account: created.id,
        scopes: ["persistent-browser-context"],
        secretRef: null,
      });
    }
    let session = resumeSessionId
      ? await browserbaseRequest(`sessions/${encodeURIComponent(resumeSessionId)}`).catch(
          () => null,
        )
      : null;
    if (
      !session ||
      typeof session.connectUrl !== "string" ||
      !["RUNNING", "PENDING"].includes(String(session.status))
    )
      session = await browserbaseRequest("sessions", {
        projectId: process.env.BROWSERBASE_PROJECT_ID,
        keepAlive: true,
        timeout: 300,
        browserSettings: {
          context: { id: connection.account, persist: true },
          solveCaptchas: false,
          recordSession: false,
          logSession: false,
          advancedStealth: false,
        },
      });
    if (typeof session.id !== "string" || typeof session.connectUrl !== "string")
      throw new JobError("Browserbase did not return a browser session.", "browser_configuration");
    sessionId = session.id;
    browser = await chromium.connectOverCDP(session.connectUrl);
    context = browser.contexts()[0] || (await browser.newContext({ serviceWorkers: "block" }));
  } else {
    if (process.env.NODE_ENV === "production" && !process.env.BROWSER_EGRESS_PROXY_URL)
      throw new JobError(
        "Production local browsers require an egress-restricted proxy or Browserbase.",
        "browser_configuration",
      );
    browser = await chromium.launch({
      headless: process.env.BROWSER_HEADLESS !== "false",
      ...(process.env.BROWSER_EGRESS_PROXY_URL
        ? { proxy: { server: process.env.BROWSER_EGRESS_PROXY_URL } }
        : {}),
    });
    context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false });
  }
  context.setDefaultTimeout(10000);
  context.setDefaultNavigationTimeout(30000);
  const allowedResources = new Set([
    start.hostname,
    ...(process.env.BROWSER_RESOURCE_DOMAINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ]);
  await context.route("**/*", async (route) => {
    const request = route.request(),
      target = request.url();
    if (target.startsWith("data:") || target.startsWith("blob:")) {
      await route.continue();
      return;
    }
    try {
      const checked = await validateJobUrl(target, { allowFixtureResource: true });
      if (!allowedResources.has(checked.hostname)) {
        await route.abort("blockedbyclient");
        return;
      }
      if (request.isNavigationRequest() && !browserDomainAllowed(target)) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });
  const page = await context.newPage();
  page.on("dialog", (dialog) => void dialog.dismiss());
  return {
    browser,
    context,
    page,
    sessionId,
    close: async (keepAlive = false) => {
      await browser.close().catch(() => {});
      if (sessionId && !keepAlive)
        await browserbaseRequest(
          `sessions/${sessionId}`,
          { projectId: process.env.BROWSERBASE_PROJECT_ID, status: "REQUEST_RELEASE" },
          "POST",
        ).catch(() => {});
    },
  };
}

export async function getBrowserHandoff(userId: string, runId: string): Promise<string | null> {
  const run = await getStore().get("agent_runs", runId, userId);
  const sessionId = run?.input?.browserSessionId;
  if (!sessionId || !process.env.BROWSERBASE_API_KEY || run?.status !== "waiting") return null;
  const result = await browserbaseRequest(`sessions/${encodeURIComponent(sessionId)}/debug`);
  const url = result.debuggerFullscreenUrl || result.debuggerUrl;
  if (typeof url !== "string" || new URL(url).protocol !== "https:") return null;
  return url;
}

export function formAnswers(
  profile: CandidateProfile,
  application: Application,
): Record<string, string> {
  const name = profile.legalName.trim().split(/\s+/);
  const eligibilityApplies =
    profile.eligibility.confirmedAt &&
    profile.eligibility.country &&
    application.job?.location.toLowerCase().includes(profile.eligibility.country.toLowerCase());
  return {
    first_name: name[0] || "",
    last_name: name.slice(1).join(" "),
    name: profile.legalName,
    email: profile.email,
    phone: profile.phone,
    location: profile.location,
    portfolio: profile.website,
    linkedin: profile.linkedin,
    github: profile.github
      ? `https://github.com/${profile.github.replace(/^https:\/\/github\.com\//, "")}`
      : "",
    ...(eligibilityApplies
      ? {
          work_authorization: profile.eligibility.workAuthorization,
          sponsorship: profile.eligibility.sponsorship,
        }
      : {}),
    // Only the explicit posting-specific eligibility checkpoint overrides profile values.
    // Other saved answers must match the current question before reuse below.
    ...Object.fromEntries(
      ["work_authorization", "sponsorship"]
        .filter(
          (key) =>
            application.eligibilityContext === eligibilityContext(profile) &&
            application.answers[key],
        )
        .map((key) => [key, application.answers[key]]),
    ),
    external_application_id: application.id,
  };
}

function fieldKey(
  name: string,
  label: string,
  fixture: boolean,
  profile: CandidateProfile,
): string | null {
  const normalized = name.toLowerCase().replace(/\[\]/g, "");
  const exact: Record<string, string> = {
    first_name: "first_name",
    firstname: "first_name",
    last_name: "last_name",
    lastname: "last_name",
    name: "name",
    email: "email",
    phone: "phone",
    telephone: "phone",
    location: "location",
    portfolio: "portfolio",
    linkedin: "linkedin",
    github: "github",
    urls: "portfolio",
    external_application_id: "external_application_id",
  };
  if (exact[normalized]) return exact[normalized];
  if (fixture && ["work_authorization", "sponsorship"].includes(normalized)) return normalized;
  const text = label.trim().toLowerCase();
  if (/^first name\b/.test(text)) return "first_name";
  if (/^last name\b/.test(text)) return "last_name";
  if (/^full (legal )?name\b/.test(text)) return "name";
  if (/^email( address)?\s*\*?$/.test(text)) return "email";
  if (/^phone( number)?\s*\*?$/.test(text)) return "phone";
  if (/^(personal )?(website|portfolio)( url| link)?\s*\*?$/.test(text)) return "portfolio";
  if (/^linkedin( profile)?( url)?\s*\*?$/.test(text)) return "linkedin";
  // Country and wording must match. Never infer legal eligibility from a university/nationality.
  if (
    profile.eligibility.confirmedAt &&
    profile.eligibility.country &&
    text.includes(profile.eligibility.country.toLowerCase()) &&
    /legally authorized to work/.test(text)
  )
    return "work_authorization";
  return null;
}

/** Fill and verify one field. A slow page can time out an action or re-render a value away,
 * which would otherwise pause the application on a field the profile already answers; one
 * idempotent retry absorbs that. Unsupported controls fail immediately. */
export async function setField(locator: Locator, value: string): Promise<boolean> {
  for (let attempt = 1; ; attempt++) {
    const result = await setFieldOnce(locator, value);
    if (result !== "retry" || attempt === 2) return result === true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
async function setFieldOnce(locator: Locator, value: string): Promise<boolean | "retry"> {
  let tag: string, type: string;
  try {
    tag = await locator.evaluate((el) => el.tagName.toLowerCase());
    type = (await locator.getAttribute("type")) || "text";
  } catch {
    return "retry";
  }
  try {
    if (tag === "select") {
      const options = await locator.locator("option").evaluateAll((elements) =>
        elements.map((el) => ({
          value: (el as HTMLOptionElement).value,
          label: (el.textContent || "").trim(),
        })),
      );
      const match = options.find(
        (o) =>
          o.value.toLowerCase() === value.toLowerCase() ||
          o.label.toLowerCase() === value.toLowerCase(),
      );
      if (!match) return false;
      await locator.selectOption(match.value);
      return (await locator.inputValue()) === match.value || "retry";
    }
    if (type === "checkbox") {
      if (!["yes", "true", "no", "false"].includes(value.toLowerCase())) return false;
      await locator.setChecked(["yes", "true"].includes(value.toLowerCase()));
      return (
        (await locator.isChecked()) === ["yes", "true"].includes(value.toLowerCase()) || "retry"
      );
    }
    if (type === "radio") return false;
    await locator.fill(value);
    return (await locator.inputValue()) === value || "retry";
  } catch {
    return "retry";
  }
}

const normalizedQuestion = (text: string) =>
  text
    .toLowerCase()
    .replace(/[\s*?:.]+/g, " ")
    .trim();
export function eligibilityContext(profile: CandidateProfile): string {
  const { country, workAuthorization, sponsorship, confirmedAt } = profile.eligibility;
  return createHash("sha256")
    .update(JSON.stringify({ country, workAuthorization, sponsorship, confirmedAt }))
    .digest("hex");
}
export function questionContext(question: { label: string; options?: string[] }): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        label: normalizedQuestion(question.label),
        options: question.options?.map(normalizedQuestion) || [],
      }),
    )
    .digest("hex");
}
export function applicationFieldAnswer(
  application: Application,
  key: string,
  question: { label: string; options?: string[] },
): string | undefined {
  return application.answerContexts?.[key] === questionContext(question)
    ? application.answers[key]
    : undefined;
}
export function rememberedFieldAnswer(
  records: ScreeningAnswer[],
  label: string,
  applicationUrl: string,
  profile: CandidateProfile,
): string | undefined {
  const matching = records.filter(
    (record) => normalizedQuestion(record.question) === normalizedQuestion(label),
  );
  const scopes = [
    applicationUrl,
    new URL(applicationUrl).hostname,
    ...(profile.eligibility.country ? [profile.eligibility.country] : []),
    "global",
  ];
  for (const scope of scopes) {
    for (const key of new Set(matching.map((record) => record.key))) {
      const answer = selectScreeningAnswer(
        matching.filter((record) => record.scope === scope),
        key,
        scope,
      );
      // Globally saved legal/health/demographic responses are never reused across contexts.
      if (
        answer &&
        !(
          answer.scope === "global" &&
          (answer.sensitive ||
            /authoriz|sponsor|disab|veteran|gender|race|ethnic|salary/i.test(label))
        )
      )
        return answer.answer;
    }
  }
  return undefined;
}

async function fillForm(
  page: Page,
  profile: CandidateProfile,
  application: Application,
  resume: Buffer,
  memories: ScreeningAnswer[],
): Promise<{
  fields: Record<string, string>;
  answerContexts: Record<string, string>;
  formSnapshotHash: string;
  questions: BrowserQuestion[];
  form: Locator | null;
}> {
  const values = formAnswers(profile, application),
    questions: BrowserQuestion[] = [],
    fields: Record<string, string> = {},
    answerContexts: Record<string, string> = {};
  const descriptors: unknown[] = [];
  // Scope every operation to the application form, never a page-wide newsletter/account form.
  const form = page
    .locator("form")
    .filter({ has: page.locator("input[type=file]") })
    .first();
  if (!(await form.count()))
    return {
      fields,
      answerContexts,
      formSnapshotHash: "",
      questions: [
        {
          key: "manual_application",
          label:
            "The application form could not be identified safely. Complete this portal manually.",
        },
      ],
      form: null,
    };
  const inputs = form.locator("input,textarea,select");
  const fixture = application.job?.ats === "fixture";
  const total = Math.min(await inputs.count(), 150);
  let uploaded = false;
  for (let index = 0; index < total; index++) {
    const input = inputs.nth(index);
    const metadata = await input.evaluate((element) => {
      const el = element as HTMLInputElement;
      const label =
        el.labels?.[0]?.textContent ||
        el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        el.name ||
        el.id;
      return {
        name: el.name,
        id: el.id,
        type: el.type,
        required: el.required || el.getAttribute("aria-required") === "true",
        label: (label || "").trim(),
        disabled: el.disabled,
      };
    });
    if (metadata.disabled || ["submit", "button", "reset"].includes(metadata.type)) continue;
    if (metadata.type === "hidden") {
      if (fixture && metadata.name === "external_application_id")
        await input.evaluate((el, id) => ((el as HTMLInputElement).value = id), application.id);
      continue;
    }
    const visible = await input.isVisible();
    const options =
      metadata.type === "select-one"
        ? (await input.locator("option").allTextContents()).map((v) => v.trim()).filter(Boolean)
        : metadata.type === "checkbox"
          ? ["yes", "no"]
          : undefined;
    // CSRF/session hidden inputs are deliberately excluded; editable field semantics are bound.
    descriptors.push({ ...metadata, visible, options });
    if (metadata.type === "file") {
      if (
        /resume|cv/i.test(`${metadata.name} ${metadata.label}`) ||
        (!uploaded && metadata.required)
      ) {
        await input.setInputFiles({
          name: "resume.pdf",
          mimeType: "application/pdf",
          buffer: resume,
        });
        uploaded = true;
        fields.resume = "resume.pdf";
      } else if (metadata.required)
        questions.push({
          key: metadata.name || metadata.id,
          label: `Required file: ${metadata.label}. Upload it manually in the employer portal.`,
        });
      continue;
    }
    if (!visible) continue;
    const key = fieldKey(metadata.name, metadata.label, fixture, profile);
    const responseKey = metadata.name || metadata.id || `field_${index}`;
    const profileValue = key ? values[key] : undefined;
    const answer =
      (profileValue && profileValue !== "unknown" ? profileValue : undefined) ??
      applicationFieldAnswer(application, responseKey, { label: metadata.label, options }) ??
      rememberedFieldAnswer(
        memories,
        metadata.label,
        application.job?.canonicalUrl || application.jobUrl,
        profile,
      );
    if (answer && answer !== "unknown" && (await setField(input, answer))) {
      fields[responseKey] = answer;
      answerContexts[responseKey] = questionContext({ label: metadata.label, options });
      continue;
    }
    const hasUnreviewedValue = ["checkbox", "radio"].includes(metadata.type)
      ? await input.isChecked()
      : !!(await input.inputValue()).trim();
    if (metadata.required || hasUnreviewedValue) {
      questions.push({
        key: responseKey,
        label: metadata.label || "An application field needs your answer.",
        ...(options ? { options: options.map((v) => v.trim()).filter(Boolean) } : {}),
      });
    }
  }
  if (!uploaded)
    questions.push({
      key: "manual_resume_upload",
      label:
        "The resume upload control is unsupported. Complete this application manually in the employer portal.",
    });
  const destination = await form.evaluate((el) => ({
    action: (el as HTMLFormElement).action,
    method: (el as HTMLFormElement).method,
  }));
  const formSnapshotHash = createHash("sha256")
    .update(JSON.stringify({ descriptors, fields, destination }))
    .digest("hex");
  return { fields, answerContexts, formSnapshotHash, questions, form };
}

export async function executeApplication(input: {
  application: Application;
  profile: CandidateProfile;
  resume: GeneratedResume;
  approved: boolean;
  reviewHash?: string;
  sessionId?: string;
  onStage?: (stage: Stage, message: string) => Promise<void>;
  beforeSubmit?: (review: FormReview) => Promise<void>;
}): Promise<BrowserOutcome> {
  const { application, profile, resume, approved } = input;
  if (!application.job || !resume.pdfKey || !resume.validation.valid)
    throw new JobError(
      "A validated resume and parsed job are required before browser execution.",
      "invalid_resume",
    );
  if (application.submissionStartedAt || application.receipt)
    return {
      kind: "unverified",
      message:
        "A submission may already have been attempted. Reconcile portal evidence before another attempt.",
    };
  if (!["fixture", "greenhouse", "lever"].includes(application.job.ats))
    return {
      kind: "needs_input",
      questions: [],
      message:
        "This employer's portal requires manual completion. Deterministic submission adapters currently support enabled Greenhouse, Lever, and the local test employer.",
    };
  const handle = await openBrowser(application.userId, application.job.url, input.sessionId);
  const started = Date.now();
  let clicked = false,
    keepAlive = false;
  const deadline = setTimeout(() => void handle.browser.close().catch(() => {}), MAX_BROWSER_MS);
  try {
    const page = handle.page;
    const applicationUrl =
      application.job.ats === "fixture"
        ? `${application.job.canonicalUrl}/apply`
        : application.job.ats === "lever"
          ? `${application.job.canonicalUrl}/apply`
          : application.job.url;
    await input.onStage?.("opening_application", "Opening the employer's application form.");
    const response = await page.goto(applicationUrl, { waitUntil: "domcontentloaded" });
    if (response && response.status() >= 400)
      throw new JobError(
        `The application page returned HTTP ${response.status()}.`,
        "portal_unavailable",
        response.status() >= 500,
      );
    await page.locator("body").waitFor();
    if (application.job.ats === "fixture")
      await page
        .locator("[data-testid='fixture-application'][data-ready='true']")
        .waitFor({ timeout: 20000 });
    if (
      await page
        .locator(
          "input[type=password],input[autocomplete='one-time-code'],input[name='otp'],input[name='verification_code'],input[name='mfa_code']",
        )
        .count()
    ) {
      keepAlive = !!handle.sessionId;
      return {
        kind: "needs_input",
        questions: [],
        login: true,
        ...(handle.sessionId ? { sessionId: handle.sessionId } : {}),
        message: handle.sessionId
          ? "Sign in through the secure live browser handoff, then continue. Your credentials stay in the managed browser context."
          : "This portal requires login. Local headless mode cannot transfer your personal browser session; configure Browserbase for a secure handoff or complete this application manually.",
      };
    }
    if (
      await page.locator("iframe[src*='recaptcha'],iframe[src*='hcaptcha'],[data-sitekey]").count()
    )
      return {
        kind: "needs_input",
        questions: [],
        message:
          "The employer requires an anti-bot challenge. Complete the application manually; the agent does not bypass challenges.",
      };
    await input.onStage?.(
      "completing_questions",
      "Filling confirmed profile details and checking required questions.",
    );
    const pdf = await readArtifact(application.userId, resume.pdfKey);
    const memories = await getStore().list("screening_answers", application.userId);
    const prepared = await fillForm(page, profile, application, pdf, memories);
    await input.onStage?.(
      "uploading",
      "Uploaded the exact validated PDF and verified supported fields.",
    );
    if (prepared.questions.length)
      return {
        kind: "needs_input",
        questions: prepared.questions,
        message: "Some required fields need your confirmed answers or a manual portal action.",
      };
    if (
      !approved ||
      (input.reviewHash !== undefined && input.reviewHash !== prepared.formSnapshotHash)
    )
      return {
        kind: "prepared",
        fields: prepared.fields,
        answerContexts: prepared.answerContexts,
        formSnapshotHash: prepared.formSnapshotHash,
      };
    if (process.env.GLOBAL_EMERGENCY_STOP === "true" || process.env.EMERGENCY_STOP === "true")
      throw new JobError(
        "Application execution is paused by the global emergency stop.",
        "emergency_stop",
      );
    const submit = prepared
      .form!.getByRole("button", { name: /^(submit application|submit|apply|send application)$/i })
      .first();
    if (!(await submit.count()) || !(await submit.isVisible()))
      return {
        kind: "needs_input",
        questions: [],
        message: "The submit control is unsupported. Review and complete the application manually.",
      };
    const formAction = await submit.evaluate((el) => {
      const form = (el as HTMLButtonElement).form;
      return form?.action || location.href;
    });
    await validateJobUrl(formAction, { allowFixtureResource: true });
    if (
      new URL(formAction).hostname !== new URL(applicationUrl).hostname &&
      !browserDomainAllowed(formAction)
    )
      throw new JobError(
        "The application form sends data to an unapproved domain.",
        "unsafe_form_action",
      );
    await input.beforeSubmit?.({
      fields: prepared.fields,
      answerContexts: prepared.answerContexts,
      formSnapshotHash: prepared.formSnapshotHash,
    });
    await input.onStage?.(
      "submitting",
      "Submitting under your saved authorization. This action will not be retried blindly.",
    );
    clicked = true;
    await submit.click({ timeout: 15000 });
    await input.onStage?.(
      "verifying",
      "Checking the employer portal for an actual submission receipt.",
    );
    const receiptSelector =
      application.job.ats === "fixture"
        ? "[data-testid='confirmation']"
        : application.job.ats === "greenhouse"
          ? "#application_confirmation, #confirmation, [data-testid='application-confirmation']"
          : ".application-confirmation, .posting-confirmation, [data-qa='application-confirmation']";
    const confirmation = page.locator(receiptSelector).first();
    await confirmation.waitFor({ state: "visible", timeout: 20000 });
    const text = (await confirmation.innerText()).trim();
    if (text.length < 8 || !/thank|received|submitted|confirmation|receipt/i.test(text))
      return {
        kind: "unverified",
        message: "The portal changed after submission, but no reliable receipt could be verified.",
      };
    const screenshot = await page.screenshot({ fullPage: true });
    const screenshotKey = await writeArtifact(
      application.userId,
      `${application.id}-receipt.png`,
      screenshot,
      "image/png",
    );
    return { kind: "submitted", confirmation: text.slice(0, 2000), url: page.url(), screenshotKey };
  } catch (error) {
    if (clicked)
      return {
        kind: "unverified",
        message:
          "Submission was initiated, but receipt verification did not complete. Review the employer portal before taking further action.",
      };
    throw error;
  } finally {
    clearTimeout(deadline);
    await handle.close(keepAlive);
    await getStore().save("usage_events", {
      ...entity(application.userId),
      kind: "browser",
      applicationId: application.id,
      quantity: (Date.now() - started) / 60000,
      costUsd: ((Date.now() - started) / 60000) * Number(process.env.BROWSER_USD_PER_MINUTE || 0),
    });
  }
}
