import { describe, expect, it, vi } from "vitest";
import { emptyProfile, entity, type Application, type ScreeningAnswer } from "../src/lib/contracts";
vi.mock("../src/lib/store", () => ({ getStore: vi.fn() }));
vi.mock("../src/lib/storage", () => ({ readArtifact: vi.fn(), writeArtifact: vi.fn() }));
import {
  applicationFieldAnswer,
  browserDomainAllowed,
  eligibilityContext,
  formAnswers,
  questionContext,
  rememberedFieldAnswer,
  setField,
} from "../src/lib/browser";
import { chromium } from "playwright";

describe("browser least privilege", () => {
  it("requires exact allowed employer domains", () => {
    process.env.BROWSER_ALLOWED_DOMAINS = "jobs.lever.co";
    expect(browserDomainAllowed("https://jobs.lever.co/example/id")).toBe(true);
    expect(browserDomainAllowed("https://jobs.lever.co.evil.example/example/id")).toBe(false);
    expect(browserDomainAllowed("https://evil.example")).toBe(false);
  });
  it("does not supply unconfirmed consequential screening answers", () => {
    const profile = emptyProfile("person@example.com", "Test Person");
    profile.eligibility.workAuthorization = "yes";
    profile.eligibility.country = "United States";
    const application: Application = {
      ...entity("user-1", "app"),
      jobUrl: "https://jobs.lever.co/example/id",
      job: null,
      status: "ready",
      runId: "run",
      resumeId: null,
      matchScore: 50,
      matchReasons: [],
      answers: {},
      receipt: null,
      error: null,
      submittedAt: null,
      submissionStartedAt: null,
      approvalId: null,
    };
    expect(formAnswers(profile, application).work_authorization).toBeUndefined();
    profile.eligibility.confirmedAt = "2026-10-30";
    application.job = { location: "United States" } as Application["job"];
    expect(formAnswers(profile, application).work_authorization).toBe("yes");
    expect(formAnswers(profile, application).first_name).toBe("Test");
    expect(formAnswers(profile, application).last_name).toBe("Person");
    application.answers = { email: "outdated@example.test", work_authorization: "no" };
    expect(formAnswers(profile, application).email).toBe(profile.email);
    expect(formAnswers(profile, application).work_authorization).toBe("yes");
    application.eligibilityContext = eligibilityContext(profile);
    expect(formAnswers(profile, application).work_authorization).toBe("no");
    profile.eligibility.country = "Canada";
    expect(formAnswers(profile, application).work_authorization).toBeUndefined();
  });
  it("binds posting-specific answers to the exact question and offered choices", () => {
    const question = { label: "Are you willing to relocate?", options: ["yes", "no"] };
    const application = {
      answers: { screening: "yes" },
      answerContexts: { screening: questionContext(question) },
    } as unknown as Application;
    expect(applicationFieldAnswer(application, "screening", question)).toBe("yes");
    expect(
      applicationFieldAnswer(application, "screening", { ...question, label: "Can you travel?" }),
    ).toBeUndefined();
    expect(
      applicationFieldAnswer(application, "screening", { ...question, options: ["now", "later"] }),
    ).toBeUndefined();
    expect(
      applicationFieldAnswer({ ...application, answerContexts: undefined }, "screening", question),
    ).toBeUndefined();
  });
  it("reuses exact screening questions in scope while declining global sensitive answers", () => {
    const profile = emptyProfile("person@example.com", "Person");
    const memory: ScreeningAnswer = {
      ...entity("user-1"),
      question: "Are you willing to relocate?",
      key: "relocation",
      answer: "yes",
      scope: "global",
      confirmed: true,
      effectiveFrom: "2026-01-01",
      effectiveUntil: null,
      sensitive: false,
    };
    expect(
      rememberedFieldAnswer(
        [memory],
        "Are you willing to relocate? *",
        "https://jobs.lever.co/example/id",
        profile,
      ),
    ).toBe("yes");
    expect(
      rememberedFieldAnswer(
        [memory],
        "Are you willing to travel?",
        "https://jobs.lever.co/example/id",
        profile,
      ),
    ).toBeUndefined();
    const sensitive = {
      ...memory,
      question: "Will you require sponsorship?",
      key: "sponsorship",
      sensitive: true,
    };
    expect(
      rememberedFieldAnswer(
        [sensitive],
        "Will you require sponsorship?",
        "https://jobs.lever.co/example/id",
        profile,
      ),
    ).toBeUndefined();
    expect(
      rememberedFieldAnswer(
        [{ ...sensitive, scope: "https://jobs.lever.co/example/id" }],
        "Will you require sponsorship?",
        "https://jobs.lever.co/example/id",
        profile,
      ),
    ).toBe("yes");
  });
});

describe("field filling under a slow page", () => {
  it("retries a fill that a late re-render clears, and still refuses unsupported controls", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      // The first value typed is wiped shortly afterwards, as a hydrating form would.
      await page.setContent(`<form><input id="first" name="first_name">
        <input id="choice" type="radio" name="choice"></form>
        <script>
          const input = document.getElementById("first");
          let wiped = false;
          input.addEventListener("input", () => {
            if (!wiped) { wiped = true; setTimeout(() => { input.value = ""; }, 0); }
          });
        </script>`);
      expect(await setField(page.locator("#first"), "Alex")).toBe(true);
      expect(await page.locator("#first").inputValue()).toBe("Alex");
      const started = Date.now();
      expect(await setField(page.locator("#choice"), "yes")).toBe(false);
      expect(Date.now() - started).toBeLessThan(400);
    } finally {
      await browser.close();
    }
  }, 30000);
});
