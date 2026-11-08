import { beforeEach, describe, expect, it } from "vitest";
import {
  aggregateAdmin,
  AdminAccessError,
  getAdminSnapshot,
  isAdmin,
  requireAdmin,
  type AdminData,
} from "../src/lib/admin";
import {
  entity,
  type AgentRun,
  type UsageEvent,
  type Subscription,
  type User,
  type Application,
  type Approval,
  type AuditAction,
  type GeneratedResume,
} from "../src/lib/contracts";
const admin: User = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.test",
  name: "Operator",
};
beforeEach(() => {
  process.env.ADMIN_USER_IDS = admin.id;
});
describe("operator authorization", () => {
  it("uses an explicit exact user-ID allowlist", () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin({ ...admin, id: admin.id + "-suffix" })).toBe(false);
    expect(isAdmin(null)).toBe(false);
    process.env.ADMIN_USER_IDS = "";
    expect(isAdmin(admin)).toBe(false);
  });
  it("denies unauthorized access before querying any store", async () => {
    expect(() => requireAdmin(null)).toThrow(AdminAccessError);
    await expect(
      getAdminSnapshot({
        ...admin,
        id: "22222222-2222-4222-8222-222222222222",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
describe("operational aggregation", () => {
  it("separates attempts, retries, verified usage, current entitlements, and recorded costs", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    const at = "2026-10-15T12:00:00Z";
    const base = { ...entity(admin.id), createdAt: at, updatedAt: at };
    const usage = (kind: UsageEvent["kind"], quantity: number, costUsd = 0): UsageEvent => ({
      ...base,
      id: crypto.randomUUID(),
      kind,
      quantity,
      costUsd,
      applicationId: "app-1",
    });
    const sub = (plan: Subscription["plan"], status: string): Subscription => ({
      ...base,
      id: crypto.randomUUID(),
      plan,
      status,
      customerId: "private-customer",
      subscriptionId: "private-subscription",
      periodEnd: "2026-11-01T00:00:00Z",
    });
    const run: AgentRun = {
      ...base,
      applicationId: "app-1",
      kind: "application",
      status: "completed",
      stage: "completed",
      attempts: 2,
      maxAttempts: 3,
      leaseUntil: null,
      nextAttemptAt: at,
      error: null,
      approved: true,
      submitted: true,
      startedAt: at,
      finishedAt: "2026-10-15T12:01:30Z",
    };
    const data: AdminData = {
      userCount: 4,
      profiles: [],
      applications: [],
      runs: [run, { ...run, id: crypto.randomUUID(), status: "queued" }],
      subscriptions: [
        sub("pro", "active"),
        sub("autonomous", "trialing"),
        sub("autonomous", "canceled"),
      ],
      usage: [
        usage("attempt", 1),
        usage("retry", 1),
        usage("verified_submission", 1),
        usage("browser", 2, 0.4),
        { ...usage("model", 1, 0.1), inputTokens: 1000, outputTokens: 100 },
      ],
    };
    const result = aggregateAdmin(data, {
      now,
      proMonthlyUsd: 39,
      autonomousMonthlyUsd: 199,
      modelPricingConfigured: false,
      browserPricingConfigured: true,
      emergencyStop: true,
    });
    expect(result.paidSubscribers).toBe(1);
    expect(result.trialSubscribers).toBe(1);
    expect(result.nominalMrrUsd).toBe(39);
    expect(result.attempts).toBe(1);
    expect(result.retries).toBe(1);
    expect(result.verifiedSubmissions).toBe(1);
    expect(result.browserMinutes).toBe(2);
    expect(result.recordedCostUsd).toBeCloseTo(0.5);
    expect(result.averageRuntimeSeconds).toBe(90);
    expect(result.costEstimateComplete).toBe(false);
    expect(result.queueDepth).toBe(1);
    expect(result.emergencyStop).toBe(true);
    expect(result.customers[0].customer).not.toContain(admin.id);
    expect(JSON.stringify(result)).not.toContain("private-customer");
    expect(JSON.stringify(result)).not.toContain(admin.email);
  });
  it("uses first-attempt and submission-start cohorts, unique clarifications, and measured generation outcomes", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    const at = "2026-11-01T12:00:00Z";
    const receipt = {
      confirmation: "private receipt",
      url: "https://private.example/receipt",
      verifiedAt: "2026-11-02T12:00:00Z",
    };
    const app = (id: string, overrides: Partial<Application> = {}): Application => ({
      ...entity(admin.id, id),
      createdAt: at,
      jobUrl: `https://private.example/${id}`,
      job: null,
      status: "ready",
      runId: crypto.randomUUID(),
      resumeId: null,
      matchScore: null,
      matchReasons: [],
      answers: {},
      receipt: null,
      error: null,
      submittedAt: null,
      submissionStartedAt: null,
      approvalId: null,
      ...overrides,
    });
    const success = app("success", { status: "interview", receipt, submissionStartedAt: at });
    const failed = app("failed", { status: "failed" });
    const pending = app("pending");
    const previous = app("previous", {
      createdAt: "2026-10-01T00:00:00Z",
      status: "submitted",
      receipt,
      submissionStartedAt: at,
    });
    const queued = app("queued");
    const sameIdOtherOwner = app("success", {
      userId: "another-owner",
      status: "submission_unverified",
      submissionStartedAt: at,
    });
    const fabricatedStatus = app("no-receipt", { status: "submitted" });
    const future = app("future");
    const usage = (
      application: Application | null,
      kind: UsageEvent["kind"],
      costUsd = 0,
      createdAt = at,
    ): UsageEvent => ({
      ...entity(application?.userId || admin.id),
      applicationId: application?.id || null,
      kind,
      costUsd,
      quantity: 1,
      createdAt,
    });
    const approval = (application: Application, kind: Approval["kind"]): Approval => ({
      ...entity(application.userId),
      createdAt: at,
      applicationId: application.id,
      runId: application.runId,
      kind,
      status: "approved",
      title: "private title",
      description: "private screening text",
      questions: [],
      response: {},
      resolvedAt: at,
    });
    const resume = (valid: boolean, createdAt = at): GeneratedResume => ({
      ...entity(admin.id),
      createdAt,
      templateId: "jakes",
      track: "general",
      applicationId: null,
      title: "private resume",
      texKey: "private.tex",
      pdfKey: "private.pdf",
      content: {
        name: "Private Candidate",
        email: admin.email,
        phone: "",
        location: "",
        links: [],
        summary: "",
        education: [],
        experience: [],
        projects: [],
        skills: [],
      },
      validation: { valid, pages: 1, errors: [], warnings: [], textExtractable: true },
      sourceClaimIds: [],
    });
    const generation = (outcome: string, createdAt = at): AuditAction => ({
      ...entity(admin.id),
      createdAt,
      action: "resume_generation_measured",
      applicationId: null,
      details: { outcome },
    });
    const alert: AuditAction = {
      ...entity(admin.id),
      createdAt: at,
      action: "execution_cost_alert",
      applicationId: success.id,
      details: {
        kind: "monthly_budget",
        recordedCostUsd: 80,
        thresholdUsd: 80,
        estimateComplete: true,
        token: "private-api-token",
      },
    };
    const data: AdminData = {
      userCount: 2,
      profiles: [],
      runs: [],
      subscriptions: [],
      applications: [
        success,
        failed,
        pending,
        previous,
        queued,
        sameIdOtherOwner,
        fabricatedStatus,
        future,
      ],
      usage: [
        usage(success, "attempt"),
        usage(success, "retry"),
        usage(success, "model", 2),
        usage(success, "browser", 3),
        usage(failed, "attempt"),
        usage(failed, "browser", 1),
        usage(pending, "attempt"),
        usage(sameIdOtherOwner, "attempt"),
        usage(sameIdOtherOwner, "browser", 4),
        usage(fabricatedStatus, "attempt"),
        usage(previous, "attempt", 0, "2026-10-20T00:00:00Z"),
        usage(previous, "retry"),
        usage(previous, "browser", 5),
        usage(future, "attempt", 0, "2026-11-05T00:00:00Z"),
        usage(success, "browser", 99, "2026-11-05T00:00:00Z"),
        usage(null, "model", 100),
      ],
      approvals: [
        approval(success, "question"),
        approval(success, "question"),
        approval(failed, "login"),
        approval(pending, "submission"),
        approval(app("success", { userId: "unrelated-owner" }), "question"),
      ],
      resumes: [resume(true), resume(false), resume(true, "2026-10-20T00:00:00Z")],
      actions: [
        generation("succeeded"),
        generation("failed"),
        generation("failed", "2026-10-20T00:00:00Z"),
        alert,
        { ...alert, id: crypto.randomUUID(), createdAt: "not-a-date" },
      ],
    };
    const result = aggregateAdmin(data, {
      now,
      proMonthlyUsd: 39,
      autonomousMonthlyUsd: 199,
      modelPricingConfigured: true,
      browserPricingConfigured: true,
      emergencyStop: false,
    });
    expect(result.outcomes.applicationCompletion).toEqual({
      numerator: 1,
      denominator: 5,
      rate: 0.2,
    });
    expect(result.outcomes.submissionVerification).toEqual({
      numerator: 2,
      denominator: 3,
      rate: 2 / 3,
    });
    expect(result.outcomes.clarificationFrequency).toEqual({
      numerator: 1,
      denominator: 5,
      rate: 0.2,
    });
    expect(result.outcomes.resumeGeneration).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
    expect(result.outcomes.savedResumeValidation).toEqual({
      numerator: 1,
      denominator: 2,
      rate: 0.5,
    });
    expect(result.outcomes.meanApplicationCostUsd).toBe(2);
    expect(result.outcomes.applicationCohortRecordedCostUsd).toBe(10);
    expect(result.costAlertCount).toBe(1);
    expect(result.costAlerts[0].customer).not.toBe(admin.id);
    expect(JSON.stringify(result)).not.toContain("private-api-token");
    expect(JSON.stringify(result)).not.toContain("private screening text");
    expect(JSON.stringify(result)).not.toContain("Private Candidate");
    expect(JSON.stringify(result)).not.toContain("private.example");
  });
  it("keeps empty or uninstrumented rates unavailable instead of reporting a successful zero", () => {
    const result = aggregateAdmin(
      {
        userCount: 0,
        profiles: [],
        applications: [],
        runs: [],
        usage: [],
        subscriptions: [],
        approvals: [],
        resumes: [],
        actions: [],
      },
      {
        now: new Date("2026-11-04T12:00:00Z"),
        proMonthlyUsd: 39,
        autonomousMonthlyUsd: 199,
        modelPricingConfigured: false,
        browserPricingConfigured: false,
        emergencyStop: false,
      },
    );
    expect(result.outcomes.applicationCompletion).toEqual({
      numerator: 0,
      denominator: 0,
      rate: null,
    });
    expect(result.outcomes.submissionVerification.rate).toBeNull();
    expect(result.outcomes.resumeGeneration.rate).toBeNull();
    expect(result.outcomes.savedResumeValidation.rate).toBeNull();
    expect(result.outcomes.meanApplicationCostUsd).toBeNull();
    expect(result.costAlerts).toEqual([]);
  });
});
