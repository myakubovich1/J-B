import { createHash } from "node:crypto";
import {
  entity,
  type AgentRun,
  type Application,
  type ApplicationStatus,
  type Approval,
  type CandidateProfile,
  type GeneratedResume,
  type Stage,
} from "./contracts";
import { getStore } from "./store";
import { getPlanState } from "./billing";
import { evaluateCostAlerts } from "./observability";
import { builtInTemplates, generateResume } from "./resume";
import { executeApplication, questionContext, eligibilityContext } from "./browser";
import { canonicalJobUrl, extractJob, JobError, matchJob, validateJobUrl } from "./jobs";

const transitions: Record<ApplicationStatus, ApplicationStatus[]> = {
  discovered: ["evaluating", "failed", "withdrawn"],
  evaluating: ["resume_preparing", "needs_input", "failed", "withdrawn"],
  resume_preparing: ["ready", "needs_input", "failed", "withdrawn"],
  ready: ["applying", "needs_input", "resume_preparing", "failed", "withdrawn"],
  applying: ["submitted", "submission_unverified", "needs_input", "failed"],
  needs_input: ["evaluating", "resume_preparing", "ready", "applying", "failed", "withdrawn"],
  submitted: ["interview", "rejected", "offer", "withdrawn"],
  submission_unverified: ["submitted", "failed", "withdrawn"],
  failed: ["evaluating", "withdrawn"],
  interview: ["rejected", "offer", "withdrawn"],
  rejected: [],
  offer: ["withdrawn"],
  withdrawn: [],
};
const emergencyStop = () =>
  process.env.GLOBAL_EMERGENCY_STOP === "true" || process.env.EMERGENCY_STOP === "true";
function intervalMinutes(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(1440, Math.max(5, parsed)) : fallback;
}
export function assertTransition(from: ApplicationStatus, to: ApplicationStatus): void {
  if (from !== to && !transitions[from].includes(to))
    throw new Error(`Invalid application transition: ${from} → ${to}`);
}
export function stableHash(value: unknown): string {
  const normalize = (data: unknown): unknown =>
    Array.isArray(data)
      ? data.map(normalize)
      : data && typeof data === "object"
        ? Object.fromEntries(
            Object.entries(data)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, normalize(v)]),
          )
        : data;
  return createHash("sha256")
    .update(JSON.stringify(normalize(value)))
    .digest("hex");
}
export function requiresResumeReview(resume: Pick<GeneratedResume, "templateId">): boolean {
  return !builtInTemplates.some((template) => template.id === resume.templateId);
}
function stableUuid(value: string): string {
  const h = createHash("sha256").update(value).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function approvalHash(application: Application, profile: CandidateProfile): string {
  return stableHash({
    profile,
    resumeId: application.resumeId,
    answers: application.answers,
    answerContexts: application.answerContexts,
    eligibilityContext: application.eligibilityContext,
    formSnapshotHash: application.formSnapshotHash,
    preparedFields: application.preparedFields,
    jobUrl: application.job?.canonicalUrl || application.jobUrl,
  });
}

async function say(userId: string, content: string, applicationId: string | null): Promise<void> {
  await getStore().save("messages", {
    ...entity(userId),
    role: "assistant",
    content,
    applicationId,
  });
}

export async function enqueueApplication(userId: string, input: string): Promise<Application> {
  if (emergencyStop())
    throw new JobError("Application execution is paused by the operator.", "emergency_stop");
  const url = await validateJobUrl(input);
  const canonical = canonicalJobUrl(url.href);
  const id = stableUuid(`application:${userId}:${canonical}`),
    runId = stableUuid(`run:${id}`);
  const existing = await getStore().get("applications", id, userId);
  if (existing) {
    if (existing.status === "failed" && !existing.submissionStartedAt)
      return retryApplication(userId, existing.id);
    await say(
      userId,
      `This job is already in your applications (${existing.status.replaceAll("_", " ")}). I won't create a duplicate.`,
      existing.id,
    );
    return existing;
  }
  const plan = await getPlanState(userId);
  if (plan.used + plan.reserved >= plan.limit)
    throw new JobError(
      "Your monthly application allowance is in use. Release pending submissions or change plans before queueing another application.",
      "quota_exceeded",
    );
  const application: Application = {
    ...entity(userId, id),
    jobUrl: canonical,
    job: null,
    status: "discovered",
    runId,
    resumeId: null,
    matchScore: null,
    matchReasons: [],
    answers: {},
    receipt: null,
    error: null,
    submittedAt: null,
    submissionStartedAt: null,
    approvalId: null,
  };
  const persisted = await getStore().createIfAbsent("applications", application);
  await getStore().createIfAbsent("agent_runs", {
    ...entity(userId, runId),
    applicationId: id,
    kind: "application",
    status: "queued",
    stage: "reading_job",
    attempts: 0,
    maxAttempts: Number(process.env.MAX_JOB_ATTEMPTS || 3),
    leaseUntil: null,
    nextAttemptAt: new Date().toISOString(),
    error: null,
    approved: false,
    submitted: false,
  });
  await getStore().save("messages", {
    ...entity(userId),
    role: "user",
    content: `Apply to ${canonical}`,
    applicationId: id,
  });
  await say(
    userId,
    "I'll read the posting, select your confirmed experience, and prepare a resume. You can review the exact application before submission.",
    id,
  );
  return persisted;
}

/** A user may explicitly retry preparation, but never an uncertain submission. */
export async function retryApplication(
  userId: string,
  applicationId: string,
): Promise<Application> {
  const store = getStore(),
    application = await store.get("applications", applicationId, userId);
  if (
    !application ||
    application.status !== "failed" ||
    application.submissionStartedAt ||
    application.receipt
  )
    throw new JobError(
      "Only a failed preparation with no submission attempt can be retried.",
      "retry_not_allowed",
    );
  const run = await store.get("agent_runs", application.runId, userId);
  if (!run) throw new JobError("The application run is missing.", "run_not_found");
  const retryRunId = stableUuid(`retry:${run.id}:${run.updatedAt}`);
  const updated = {
    ...application,
    runId: retryRunId,
    status: "evaluating" as const,
    error: null,
    approvalId: null,
  };
  await store.save("applications", updated);
  await store.createIfAbsent("agent_runs", {
    ...run,
    ...entity(userId, retryRunId),
    status: "queued",
    stage: "reading_job",
    attempts: 0,
    approved: false,
    leaseUntil: null,
    error: null,
    nextAttemptAt: new Date().toISOString(),
  });
  await store.save("agent_actions", {
    ...entity(userId),
    action: "preparation_retry_requested",
    applicationId,
    details: { runId: retryRunId, previousRunId: run.id },
  });
  await say(
    userId,
    "I'll retry preparation using your current profile. A fresh review is required before any submission.",
    applicationId,
  );
  return updated;
}

export async function resolveApproval(
  userId: string,
  approvalId: string,
  decision: "approve" | "deny",
  answers: Record<string, string> = {},
): Promise<void> {
  const store = getStore(),
    approval = await store.get("approval_requests", approvalId, userId);
  if (!approval || approval.status !== "pending")
    throw new JobError(
      "This approval has already been resolved or is unavailable.",
      "approval_not_found",
    );
  const run = await store.get("agent_runs", approval.runId, userId),
    application = await store.get("applications", approval.applicationId, userId);
  if (!run || !application || run.status !== "waiting" || application.approvalId !== approval.id)
    throw new JobError("This approval no longer matches the active application.", "stale_approval");
  if (application.submissionStartedAt)
    throw new JobError(
      "A submission has already started. Reconcile its receipt before taking another action.",
      "submission_started",
    );
  if (decision === "deny") {
    await store.save("approval_requests", {
      ...approval,
      status: "denied",
      resolvedAt: new Date().toISOString(),
    });
    await store.save("agent_runs", {
      ...run,
      status: "failed",
      stage: "failed",
      error: "Stopped by user",
      leaseUntil: null,
      finishedAt: new Date().toISOString(),
    });
    await store.save("applications", {
      ...application,
      status: "withdrawn",
      error: "Stopped before submission by user.",
    });
    await store.releaseSubmission(userId, application.id);
    await say(userId, "Stopped this application before submission.", application.id);
    return;
  }
  const profiles = await store.list("candidate_profiles", userId);
  const profile = profiles[0]?.profile;
  if (!profile) throw new JobError("Complete your career profile first.", "profile_required");
  if (
    approval.kind === "submission" &&
    approval.snapshotHash !== approvalHash(application, profile)
  ) {
    await store.save("approval_requests", {
      ...approval,
      status: "denied",
      resolvedAt: new Date().toISOString(),
      description: "Profile or application changed; a fresh review is required.",
    });
    await store.save("agent_runs", {
      ...run,
      status: "queued",
      approved: false,
      stage: "selecting_resume",
      leaseUntil: null,
      attempts: 0,
      nextAttemptAt: new Date().toISOString(),
    });
    await say(
      userId,
      "Your profile or application changed. I'll prepare a fresh version for your review.",
      application.id,
    );
    return;
  }
  const responses: Record<string, string> = {};
  for (const question of approval.questions) {
    const value = answers[question.key]?.trim();
    if (!value || value.length > 5000)
      throw new JobError(`Provide a confirmed answer for: ${question.label}`, "answer_required");
    if (
      question.options?.length &&
      !question.options.some((option) => option.toLowerCase() === value.toLowerCase())
    )
      throw new JobError(`Choose an offered answer for: ${question.label}`, "invalid_answer");
    responses[question.key] = value;
  }
  await store.save("approval_requests", {
    ...approval,
    status: "approved",
    response: responses,
    resolvedAt: new Date().toISOString(),
  });
  if (approval.kind === "question") {
    const merged = { ...application.answers, ...responses };
    await store.save("applications", {
      ...application,
      answers: merged,
      answerContexts: {
        ...application.answerContexts,
        ...Object.fromEntries(approval.questions.map((q) => [q.key, questionContext(q)])),
      },
      ...(approval.title === "Confirm work eligibility"
        ? { eligibilityContext: eligibilityContext(profile) }
        : {}),
      approvalId: null,
      error: null,
    });
    for (const question of approval.questions)
      await store.save("screening_answers", {
        ...entity(userId, stableUuid(`${userId}:${application.jobUrl}:${question.key}`)),
        question: question.label,
        key: question.key,
        answer: responses[question.key],
        scope: application.job?.canonicalUrl || application.jobUrl,
        confirmed: true,
        effectiveFrom: new Date().toISOString(),
        effectiveUntil: null,
        sensitive: /authorization|sponsor|disab|veteran|gender|race|ethnic|salary/i.test(
          question.label,
        ),
      });
  }
  await store.save("agent_actions", {
    ...entity(userId),
    action: `${approval.kind}_approved`,
    applicationId: application.id,
    details: { approvalId: approval.id, snapshotHash: approval.snapshotHash || null },
  });
  await store.save("agent_runs", {
    ...run,
    status: "queued",
    approved: approval.kind === "submission",
    stage: approval.kind === "submission" ? "opening_application" : "completing_questions",
    attempts: 0,
    leaseUntil: null,
    nextAttemptAt: new Date().toISOString(),
    error: null,
  });
  await say(
    userId,
    approval.kind === "submission"
      ? "Authorization recorded for this exact resume and application. I'll submit once and verify the receipt."
      : "Your answers are saved. I'll check the application again before requesting submission approval.",
    application.id,
  );
}

async function pending(
  run: AgentRun,
  application: Application,
  kind: Approval["kind"],
  title: string,
  description: string,
  questions: Approval["questions"],
  profile: CandidateProfile,
): Promise<void> {
  const store = getStore();
  const liveApplication = await store.get("applications", application.id, run.userId);
  const liveRun = await store.get("agent_runs", run.id, run.userId);
  if (liveApplication?.status === "withdrawn" || liveRun?.status !== "running")
    throw new JobError(
      "This application was stopped before the approval checkpoint.",
      "authorization_revoked",
    );
  const approval: Approval = {
    ...entity(run.userId),
    applicationId: application.id,
    runId: run.id,
    kind,
    status: "pending",
    title,
    description,
    questions,
    response: {},
    resolvedAt: null,
    ...(kind === "submission" ? { snapshotHash: approvalHash(application, profile) } : {}),
  };
  await store.save("approval_requests", approval);
  await store.save("applications", {
    ...application,
    status: kind === "submission" ? "ready" : "needs_input",
    approvalId: approval.id,
    error: kind === "submission" ? null : description,
  });
  await store.save("agent_runs", {
    ...run,
    status: "waiting",
    stage: kind === "submission" ? "awaiting_approval" : "needs_input",
    leaseUntil: null,
    error: null,
  });
  await store.save("application_events", {
    ...entity(run.userId),
    applicationId: application.id,
    runId: run.id,
    stage: kind === "submission" ? "awaiting_approval" : "needs_input",
    message: description,
  });
  await say(run.userId, description, application.id);
}

async function standingAuthorization(
  profile: CandidateProfile,
  application: Application,
): Promise<boolean> {
  const plan = await getPlanState(application.userId);
  if (
    !plan.discovery ||
    !profile.autonomy.enabled ||
    !profile.autonomy.approvedAt ||
    !application.job
  )
    return false;
  if (
    !profile.autonomy.allowedDomains.includes(new URL(application.job.url).hostname) ||
    (application.matchScore || 0) < profile.autonomy.minScore
  )
    return false;
  if (
    !profile.eligibility.confirmedAt ||
    profile.eligibility.workAuthorization !== "yes" ||
    profile.eligibility.sponsorship !== "no" ||
    !profile.eligibility.country ||
    !application.job.location.toLowerCase().includes(profile.eligibility.country.toLowerCase())
  )
    return false;
  const today = new Date().toISOString().slice(0, 10);
  const applications = await getStore().list("applications", application.userId);
  return (
    applications.filter((a) => a.submissionStartedAt?.startsWith(today)).length <
    profile.autonomy.maxPerDay
  );
}

async function processRun(claimed: AgentRun): Promise<void> {
  const store = getStore();
  let run = claimed;
  if (run.kind === "import") {
    const source = run.input?.sourceId
      ? await store.get("profile_sources", run.input.sourceId, run.userId)
      : null;
    if (!source?.storageKey)
      throw new JobError("The imported source is unavailable.", "source_missing");
    try {
      const [{ readArtifact }, { extractDocument }, { extractImportRecords }] = await Promise.all([
        import("./storage"),
        import("./imports"),
        import("./import-review"),
      ]);
      const text = await extractDocument(
        source.name,
        await readArtifact(run.userId, source.storageKey),
      );
      await store.save("profile_sources", {
        ...source,
        text: text.slice(0, 100000),
        status: "ready",
        structured: extractImportRecords(source.name, text),
        error: undefined,
      });
      await store.save("agent_runs", {
        ...run,
        status: "completed",
        stage: "completed",
        leaseUntil: null,
        finishedAt: new Date().toISOString(),
      });
      await say(
        run.userId,
        `Your document ${source.name} is ready to review in Career Profile → Saved sources. Imported text is not used as a confirmed fact until you review it.`,
        null,
      );
    } catch (e) {
      await store.save("profile_sources", {
        ...source,
        status: "failed",
        error: e instanceof Error ? e.message : "Extraction failed.",
      });
      throw e;
    }
    return;
  }
  if (run.kind === "email") {
    const plan = await getPlanState(run.userId);
    const connected = (await store.list("integration_connections", run.userId)).some(
      (c) => ["gmail", "microsoft", "outlook"].includes(c.provider) && c.status === "connected",
    );
    if (!plan.discovery || !connected)
      throw new JobError(
        "Scheduled email monitoring requires an active Autonomous plan and an explicitly connected inbox.",
        "email_monitoring_disabled",
      );
    const { syncApplicationMail } = await import("./integrations");
    await syncApplicationMail(run.userId);
    await store.save("agent_runs", {
      ...run,
      status: "completed",
      stage: "completed",
      leaseUntil: null,
      finishedAt: new Date().toISOString(),
    });
    const stillConnected = (await store.list("integration_connections", run.userId)).some(
      (c) => ["gmail", "microsoft", "outlook"].includes(c.provider) && c.status === "connected",
    );
    const otherPending = (await store.list("agent_runs", run.userId)).some(
      (other) =>
        other.id !== run.id &&
        other.kind === "email" &&
        ["queued", "running"].includes(other.status),
    );
    if (stillConnected && (await getPlanState(run.userId)).discovery && !otherPending)
      await store.createIfAbsent("agent_runs", {
        ...entity(run.userId, stableUuid(`email-after:${run.id}`)),
        applicationId: "",
        kind: "email",
        status: "queued",
        stage: "reading_job",
        attempts: 0,
        maxAttempts: 2,
        leaseUntil: null,
        nextAttemptAt: new Date(
          Date.now() + intervalMinutes(process.env.EMAIL_POLL_INTERVAL_MINUTES, 5) * 60000,
        ).toISOString(),
        error: null,
        approved: false,
        submitted: false,
      });
    return;
  }
  const profiles = await store.list("candidate_profiles", run.userId),
    profile = profiles[0]?.profile;
  if (!profile || !profile.legalName.trim() || !profile.email)
    throw new JobError(
      "Complete your name and email in Career Profile before running the agent.",
      "profile_required",
    );
  const stage = async (next: Stage, message: string) => {
    const liveRun = await store.get("agent_runs", run.id, run.userId);
    if (liveRun?.status !== "running")
      throw new JobError(
        "This run was stopped or its authorization changed.",
        "authorization_revoked",
      );
    if (run.applicationId) {
      const liveApplication = await store.get("applications", run.applicationId, run.userId);
      if (liveApplication?.status === "withdrawn")
        throw new JobError(
          "This application was withdrawn before submission.",
          "authorization_revoked",
        );
    }
    run = { ...run, stage: next, leaseUntil: new Date(Date.now() + 600000).toISOString() };
    await store.save("agent_runs", run);
    if (run.applicationId)
      await store.save("application_events", {
        ...entity(run.userId),
        applicationId: run.applicationId,
        runId: run.id,
        stage: next,
        message,
      });
  };
  if (run.kind === "resume") {
    await stage(
      "generating_pdf",
      "Generating and validating a resume from confirmed profile facts.",
    );
    const resume = await generateResume({
      userId: run.userId,
      profile,
      templateId: run.input?.templateId || profile.defaultTemplate,
      track:
        (run.input?.track as "software" | "finance" | "consulting" | "product" | "general") ||
        profile.preferences.tracks[0] ||
        "general",
    });
    if (!resume.validation.valid || !resume.pdfKey)
      throw new JobError(
        resume.validation.errors.join(" ") || "Resume PDF validation failed.",
        "invalid_resume",
      );
    await store.save("agent_runs", {
      ...run,
      status: "completed",
      stage: "completed",
      resumeId: resume.id,
      leaseUntil: null,
      finishedAt: new Date().toISOString(),
    });
    await say(
      run.userId,
      `Your ${resume.title} is ready in Resumes. The PDF was compiled and its text validated.`,
      null,
    );
    return;
  }
  if (run.kind === "discovery") {
    const { monitorSources } = await import("./discovery");
    await monitorSources(run.userId);
    await store.save("agent_runs", {
      ...run,
      status: "completed",
      stage: "completed",
      leaseUntil: null,
      finishedAt: new Date().toISOString(),
    });
    const otherPending = (await store.list("agent_runs", run.userId)).some(
      (other) =>
        other.id !== run.id &&
        other.kind === "discovery" &&
        ["queued", "running"].includes(other.status),
    );
    if ((await getPlanState(run.userId)).discovery && profile.autonomy.enabled && !otherPending) {
      await store.createIfAbsent("agent_runs", {
        ...entity(run.userId, stableUuid(`discovery-after:${run.id}`)),
        applicationId: "",
        kind: "discovery",
        status: "queued",
        stage: "reading_job",
        attempts: 0,
        maxAttempts: 2,
        leaseUntil: null,
        nextAttemptAt: new Date(
          Date.now() + intervalMinutes(process.env.DISCOVERY_INTERVAL_MINUTES, 60) * 60000,
        ).toISOString(),
        error: null,
        approved: false,
        submitted: false,
      });
    }
    return;
  }
  let application = await store.get("applications", run.applicationId, run.userId);
  if (!application) throw new JobError("The application was removed.", "application_not_found");
  if (application.runId !== run.id) {
    await store.save("agent_runs", {
      ...run,
      status: "failed",
      stage: "failed",
      leaseUntil: null,
      error: "Superseded by a newer preparation run.",
    });
    return;
  }
  if (application.status === "submitted" || application.receipt) {
    if (application.receipt) await store.recordVerifiedSubmission(run.userId, application.id);
    await store.save("agent_runs", {
      ...run,
      status: "completed",
      stage: "completed",
      submitted: true,
      leaseUntil: null,
    });
    return;
  }
  if (application.submissionStartedAt) {
    await store.save("applications", {
      ...application,
      status: "submission_unverified",
      error:
        "The worker recovered after submission started. Verify the employer's receipt before retrying.",
    });
    await store.save("agent_runs", {
      ...run,
      status: "waiting",
      stage: "needs_input",
      leaseUntil: null,
      error: "Submission recovery requires reconciliation.",
    });
    return;
  }
  await store.save("usage_events", {
    ...entity(run.userId),
    kind: run.attempts > 1 ? "retry" : "attempt",
    applicationId: application.id,
    quantity: 1,
    costUsd: 0,
  });
  if (!application.job) {
    application = { ...application, status: "evaluating", error: null };
    await store.save("applications", application);
    await stage("reading_job", "Reading employer job metadata from the supported source.");
    const job = await extractJob(application.jobUrl, run.userId);
    application = { ...application, job };
    await store.save("applications", application);
  }
  const job = application.job!;
  await stage("evaluating", "Comparing confirmed skills, preferences, and eligibility details.");
  const match = matchJob(profile, job);
  application = { ...application, matchScore: match.score, matchReasons: match.reasons };
  await store.save("applications", application);
  if (match.blocked) throw new JobError(match.reasons.join(" "), "preference_excluded");
  if (
    match.needsConfirmation &&
    (!application.answers.work_authorization ||
      application.eligibilityContext !== eligibilityContext(profile))
  ) {
    await pending(
      run,
      application,
      "question",
      "Confirm work eligibility",
      "Confirm eligibility for this employer's job country. These answers apply only to this posting.",
      [
        {
          key: "work_authorization",
          label: "Are you currently legally authorized to work in the country of this posting?",
          options: ["yes", "no"],
        },
        {
          key: "sponsorship",
          label: "Will you require employer sponsorship for this role?",
          options: ["yes", "no"],
        },
      ],
      profile,
    );
    return;
  }
  const profileHash = stableHash(profile);
  let resume = application.resumeId
    ? await store.get("generated_resumes", application.resumeId, run.userId)
    : null;
  if (!resume || run.input?.resumeProfileHash !== profileHash) {
    await stage("selecting_resume", `Selecting your ${job.track} resume template.`);
    application = { ...application, status: "resume_preparing", approvalId: null };
    await store.save("applications", application);
    await stage(
      "tailoring",
      "Selecting relevant confirmed accomplishments; imported suggestions remain excluded.",
    );
    await stage(
      "generating_pdf",
      "Rendering structured resume content into LaTeX and compiling a PDF.",
    );
    resume = await generateResume({
      userId: run.userId,
      profile,
      templateId: profile.trackTemplates[job.track] || profile.defaultTemplate,
      track: job.track,
      job,
      applicationId: application.id,
    });
    application = { ...application, resumeId: resume.id };
    await store.save("applications", application);
    run = { ...run, approved: false, input: { ...run.input, resumeProfileHash: profileHash } };
    await store.save("agent_runs", run);
  }
  await stage(
    "validating_resume",
    "Checking PDF identity, extractable text, provenance, and page count.",
  );
  if (!resume.validation.valid || !resume.pdfKey)
    throw new JobError(
      resume.validation.errors.join(" ") || "Resume PDF validation failed.",
      "invalid_resume",
    );
  application = { ...application, status: "ready", error: null };
  await store.save("applications", application);
  // Custom source may contain prose outside the structured placeholders. Its actual PDF must
  // be reviewed even when the user has standing permission for supported employer domains.
  const auto = !requiresResumeReview(resume) && (await standingAuthorization(profile, application));
  const outcome = await executeApplication({
    application,
    profile,
    resume,
    approved: run.approved || auto,
    ...(!auto && run.approved ? { reviewHash: application.formSnapshotHash || "" } : {}),
    sessionId: run.input?.browserSessionId,
    onStage: stage,
    beforeSubmit: async (review) => {
      if (emergencyStop()) throw new JobError("Application execution is paused.", "emergency_stop");
      // Re-read policy and state at the last possible moment, after browser preparation.
      const fresh = await store.get("applications", application!.id, run.userId);
      const freshProfile = (await store.list("candidate_profiles", run.userId))[0]?.profile;
      const liveRun = await store.get("agent_runs", run.id, run.userId);
      if (
        !fresh ||
        fresh.submissionStartedAt ||
        fresh.status !== "ready" ||
        liveRun?.status !== "running" ||
        !freshProfile
      )
        throw new JobError(
          "Submission state or authorization changed. Review the application.",
          "stale_submission",
        );
      if (auto) {
        if (stableHash(freshProfile) !== profileHash)
          throw new JobError(
            "Your profile changed during preparation. Prepare a fresh application before submitting.",
            "profile_changed",
          );
        if (!(await standingAuthorization(freshProfile, fresh)))
          throw new JobError(
            "Standing authorization was paused or changed.",
            "authorization_revoked",
          );
      } else {
        const approval = fresh.approvalId
          ? await store.get("approval_requests", fresh.approvalId, run.userId)
          : null;
        if (
          !approval ||
          approval.status !== "approved" ||
          approval.kind !== "submission" ||
          approval.snapshotHash !== approvalHash(fresh, freshProfile)
        )
          throw new JobError(
            "A current approval for this exact application is required.",
            "approval_required",
          );
      }
      const plan = await getPlanState(run.userId);
      if (!(await store.reserveSubmission(run.userId, fresh.id, plan.limit)))
        throw new JobError("Your monthly application allowance is exhausted.", "quota_exceeded");
      application = {
        ...fresh,
        answers: { ...fresh.answers, ...review.fields },
        answerContexts: { ...fresh.answerContexts, ...review.answerContexts },
        preparedFields: review.fields,
        formSnapshotHash: review.formSnapshotHash,
        status: "applying",
        submissionStartedAt: new Date().toISOString(),
      };
      await store.save("applications", application);
      await store.save("agent_actions", {
        ...entity(run.userId),
        action: "submission_started",
        applicationId: fresh.id,
        details: {
          resumeId: resume!.id,
          standingAuthorization: auto,
          approvalId: fresh.approvalId,
        },
      });
    },
  });
  if (outcome.kind === "needs_input") {
    if (outcome.sessionId)
      run = { ...run, input: { ...run.input, browserSessionId: outcome.sessionId } };
    await pending(
      run,
      application,
      outcome.login ? "login" : "question",
      outcome.login ? "Secure sign-in needed" : "Application needs your input",
      outcome.message,
      outcome.questions,
      profile,
    );
    return;
  }
  if (outcome.kind === "prepared") {
    application = {
      ...application,
      answers: { ...application.answers, ...outcome.fields },
      answerContexts: { ...application.answerContexts, ...outcome.answerContexts },
      formSnapshotHash: outcome.formSnapshotHash,
      preparedFields: outcome.fields,
    };
    await store.save("applications", application);
    await pending(
      run,
      application,
      "submission",
      `Submit to ${job.company}?`,
      `Your ${job.title} application is ready. Review the exact resume and answers, then authorize one submission.${requiresResumeReview(resume) ? " Your custom template may contain additional text; check the complete compiled PDF before approving." : ""}`,
      [],
      profile,
    );
    return;
  }
  if (outcome.kind === "unverified") {
    await store.save("applications", {
      ...application,
      status: "submission_unverified",
      error: outcome.message,
    });
    await store.save("agent_runs", {
      ...run,
      status: "waiting",
      stage: "needs_input",
      error: outcome.message,
      leaseUntil: null,
    });
    await say(run.userId, outcome.message, application.id);
    return;
  }
  const verifiedAt = new Date().toISOString();
  application = {
    ...application,
    status: "submitted",
    receipt: {
      confirmation: outcome.confirmation,
      url: outcome.url,
      verifiedAt,
      ...(outcome.screenshotKey ? { screenshotKey: outcome.screenshotKey } : {}),
    },
    submittedAt: verifiedAt,
    error: null,
  };
  await store.save("applications", application);
  await store.recordVerifiedSubmission(run.userId, application.id);
  await stage("completed", "The employer portal returned a verified submission receipt.");
  await store.save("agent_runs", {
    ...run,
    status: "completed",
    stage: "completed",
    submitted: true,
    leaseUntil: null,
    finishedAt: verifiedAt,
  });
  await store.save("notifications", {
    ...entity(run.userId),
    title: `Applied to ${job.company}`,
    body: `${job.title} — submission confirmed by the employer portal.`,
    read: false,
    applicationId: application.id,
  });
  await say(
    run.userId,
    `Your application for ${job.title} at ${job.company} was submitted. The portal receipt and exact resume are saved in Applications.`,
    application.id,
  );
}

export async function runOnce(): Promise<boolean> {
  if (emergencyStop()) return false;
  const store = getStore(),
    run = await store.claimRun();
  if (!run) return false;
  const started = Date.now();
  try {
    const usage = await store.list("usage_events", run.userId);
    const monthlyCost = usage
      .filter((u) => u.createdAt.startsWith(new Date().toISOString().slice(0, 7)))
      .reduce((sum, u) => sum + u.costUsd, 0);
    if (monthlyCost >= Number(process.env.PER_USER_MONTHLY_BUDGET_USD || 100))
      throw new JobError(
        "Your configured execution budget has been reached. Contact the operator to adjust it.",
        "budget_exceeded",
      );
    await processRun({ ...run, startedAt: run.startedAt || new Date().toISOString() });
  } catch (error) {
    const application = run.applicationId
      ? await store.get("applications", run.applicationId, run.userId)
      : null;
    if (application?.status === "withdrawn") {
      const current = (await store.get("agent_runs", run.id, run.userId)) || run;
      await store.save("agent_runs", {
        ...current,
        status: "failed",
        stage: "failed",
        leaseUntil: null,
        error: "Stopped by user.",
        finishedAt: new Date().toISOString(),
      });
      if (!application.submissionStartedAt)
        await store.releaseSubmission(run.userId, application.id);
      return true;
    }
    const message = error instanceof Error ? error.message : "The worker failed unexpectedly.";
    const ambiguous = !!application?.submissionStartedAt;
    const retryable =
      error instanceof JobError && error.retryable && !ambiguous && run.attempts < run.maxAttempts;
    const current = (await store.get("agent_runs", run.id, run.userId)) || run;
    await store.save("agent_runs", {
      ...current,
      status: ambiguous ? "waiting" : retryable ? "queued" : "failed",
      stage: ambiguous ? "needs_input" : "failed",
      leaseUntil: null,
      error: message,
      nextAttemptAt: new Date(
        Date.now() + Math.min(300000, 5000 * 2 ** run.attempts),
      ).toISOString(),
      ...(!retryable ? { finishedAt: new Date().toISOString() } : {}),
    });
    if (application) {
      await store.save("applications", {
        ...application,
        status: ambiguous ? "submission_unverified" : retryable ? application.status : "failed",
        error: message,
      });
      if (!ambiguous) await store.releaseSubmission(run.userId, application.id);
      await store.save("application_events", {
        ...entity(run.userId),
        applicationId: application.id,
        runId: run.id,
        stage: ambiguous ? "needs_input" : "failed",
        message,
        details: {
          category: error instanceof JobError ? error.code : "unexpected",
          retryable,
          durationMs: Date.now() - started,
        },
      });
    }
    await say(
      run.userId,
      retryable ? `${message} I'll retry this preparation step safely.` : message,
      application?.id || null,
    );
  } finally {
    await evaluateCostAlerts(run.userId, run.applicationId || null).catch(() => {
      console.error(JSON.stringify({ level: "error", event: "cost_alert_recording_failed" }));
    });
  }
  return true;
}
