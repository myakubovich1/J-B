import { createHash } from "node:crypto";
import type {
  AgentRun,
  Application,
  AppEvent,
  Approval,
  AuditAction,
  GeneratedResume,
  ProfileRecord,
  Subscription,
  UsageEvent,
  User,
} from "./contracts";
import { appMode, localDb, supabaseService } from "./store";
import { readCostAlert } from "./observability";

export class AdminAccessError extends Error {
  constructor(public status: 401 | 403) {
    super("Operator access required");
  }
}
export function isAdmin(user: User | null): boolean {
  if (!user) return false;
  const allowed = (process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) =>
      /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id),
    );
  return allowed.includes(user.id);
}
export function requireAdmin(user: User | null): asserts user is User {
  if (!isAdmin(user)) throw new AdminAccessError(user ? 403 : 401);
}
export type AdminData = {
  userCount: number;
  profiles: ProfileRecord[];
  applications: Application[];
  runs: AgentRun[];
  usage: UsageEvent[];
  subscriptions: Subscription[];
  events?: AppEvent[];
  approvals?: Approval[];
  resumes?: GeneratedResume[];
  actions?: AuditAction[];
};
export type AdminOptions = {
  now: Date;
  proMonthlyUsd: number;
  autonomousMonthlyUsd: number;
  modelPricingConfigured: boolean;
  browserPricingConfigured: boolean;
  emergencyStop: boolean;
};
const amount = (value: number) => (Number.isFinite(value) ? value : 0);
const safeDate = (value: string | undefined | null) => (value ? new Date(value).getTime() : NaN);
const metric = (numerator: number, denominator: number) => ({
  numerator,
  denominator,
  rate: denominator ? numerator / denominator : null,
});
const ownedKey = (userId: string, id: string) => `${userId}:${id}`;
export function aggregateAdmin(data: AdminData, options: AdminOptions) {
  const now = options.now.getTime();
  const month = new Date(Date.UTC(options.now.getUTCFullYear(), options.now.getUTCMonth(), 1));
  const start = month.getTime();
  const recent = now - 30 * 86400000;
  const monthlyUsage = data.usage.filter(
    (event) => safeDate(event.createdAt) >= start && safeDate(event.createdAt) <= now,
  );
  const monthlyRuns = data.runs.filter(
    (run) => safeDate(run.createdAt) >= start && safeDate(run.createdAt) <= now,
  );
  const monthlyApplications = data.applications.filter(
    (app) => safeDate(app.createdAt) >= start && safeDate(app.createdAt) <= now,
  );
  // Application rates use first-attempt cohorts, so a resume-only job, retry, or queued item
  // cannot silently inflate the denominator. The cohort includes work still in progress.
  const firstAttempts = new Map<string, number>();
  for (const event of data.usage) {
    if (event.kind !== "attempt" || !event.applicationId) continue;
    const at = safeDate(event.createdAt);
    if (!Number.isFinite(at) || at > now) continue;
    const key = ownedKey(event.userId, event.applicationId);
    firstAttempts.set(key, Math.min(firstAttempts.get(key) ?? Infinity, at));
  }
  const applicationCohort = data.applications.filter((application) => {
    const at = firstAttempts.get(ownedKey(application.userId, application.id));
    return at !== undefined && at >= start && at <= now;
  });
  const cohortKeys = new Set(applicationCohort.map((app) => ownedKey(app.userId, app.id)));
  const hasReceipt = (application: Application) => {
    const at = safeDate(application.receipt?.verifiedAt);
    return Number.isFinite(at) && at <= now;
  };
  const submissionCohort = data.applications.filter((application) => {
    const at = safeDate(application.submissionStartedAt);
    return at >= start && at <= now;
  });
  const clarified = new Set(
    (data.approvals || [])
      .filter((approval) => {
        const key = ownedKey(approval.userId, approval.applicationId);
        const at = safeDate(approval.createdAt);
        return (
          approval.kind === "question" &&
          cohortKeys.has(key) &&
          at >= (firstAttempts.get(key) ?? Infinity) &&
          at <= now
        );
      })
      .map((approval) => ownedKey(approval.userId, approval.applicationId)),
  );
  const cohortUsage = data.usage.filter(
    (event) =>
      event.applicationId &&
      cohortKeys.has(ownedKey(event.userId, event.applicationId)) &&
      safeDate(event.createdAt) <= now,
  );
  const cohortCost = cohortUsage.reduce(
    (sum, event) => sum + Math.max(0, amount(event.costUsd)),
    0,
  );
  const monthlyResumes = (data.resumes || []).filter(
    (resume) => safeDate(resume.createdAt) >= start && safeDate(resume.createdAt) <= now,
  );
  const measuredGenerations = (data.actions || []).filter(
    (action) =>
      action.action === "resume_generation_measured" &&
      (action.details.outcome === "succeeded" || action.details.outcome === "failed") &&
      safeDate(action.createdAt) >= start &&
      safeDate(action.createdAt) <= now,
  );
  const costAlerts = (data.actions || [])
    .flatMap((action) => {
      const alert = readCostAlert(action);
      const at = safeDate(action.createdAt);
      if (!alert || !Number.isFinite(at) || at < start || at > now) return [];
      return [
        {
          ...alert,
          observedAt: action.createdAt,
          customer: createHash("sha256").update(action.userId).digest("hex").slice(0, 12),
        },
      ];
    })
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const activeIds = new Set<string>();
  for (const item of [...data.profiles, ...data.runs, ...data.usage]) {
    const date =
      "kind" in item &&
      ["attempt", "verified_submission", "model", "browser", "retry", "reservation"].includes(
        item.kind,
      )
        ? item.createdAt
        : item.updatedAt;
    if (safeDate(date) >= recent && safeDate(date) <= now) activeIds.add(item.userId);
  }
  const paid = data.subscriptions.filter(
    (sub) =>
      sub.plan !== "free" &&
      sub.status === "active" &&
      (!sub.periodEnd || safeDate(sub.periodEnd) > now),
  );
  const nominalMrr = paid.reduce(
    (sum, sub) =>
      sum + (sub.plan === "autonomous" ? options.autonomousMonthlyUsd : options.proMonthlyUsd),
    0,
  );
  const durations = monthlyRuns
    .filter(
      (run) =>
        run.kind === "application" &&
        ["completed", "failed"].includes(run.status) &&
        run.startedAt &&
        run.finishedAt,
    )
    .map((run) => (safeDate(run.finishedAt) - safeDate(run.startedAt)) / 1000)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const verified = new Set(
    monthlyUsage
      .filter((event) => event.kind === "verified_submission" && event.applicationId)
      .map((event) => event.applicationId),
  );
  const attempts = monthlyUsage
    .filter((event) => event.kind === "attempt")
    .reduce((sum, event) => sum + amount(event.quantity), 0);
  const retries = monthlyUsage
    .filter((event) => event.kind === "retry")
    .reduce((sum, event) => sum + amount(event.quantity), 0);
  const browser = monthlyUsage.filter((event) => event.kind === "browser");
  const model = monthlyUsage.filter((event) => event.kind === "model");
  const costUsd = monthlyUsage.reduce((sum, event) => sum + amount(event.costUsd), 0);
  const eventCategories = new Map<string, string>();
  for (const event of [...(data.events || [])].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  )) {
    const category = event.details?.category;
    if (typeof category === "string" && /^[a-z_]{1,60}$/.test(category))
      eventCategories.set(event.runId, category);
  }
  const failureCategories: Record<string, number> = {};
  for (const run of monthlyRuns.filter((run) => run.status === "failed")) {
    const category = (eventCategories.get(run.id) || "uncategorized").replace(/_/g, " ");
    failureCategories[category] = (failureCategories[category] || 0) + 1;
  }
  const costByUser = new Map<string, { costUsd: number; verified: number; attempts: number }>();
  for (const event of monthlyUsage) {
    const metric = costByUser.get(event.userId) || {
      costUsd: 0,
      verified: 0,
      attempts: 0,
    };
    metric.costUsd += amount(event.costUsd);
    if (event.kind === "verified_submission") metric.verified += 1;
    if (event.kind === "attempt") metric.attempts += amount(event.quantity);
    costByUser.set(event.userId, metric);
  }
  const daily = new Map<string, { day: string; attempts: number; verified: number }>();
  for (let day = 1; day <= options.now.getUTCDate(); day++) {
    const key = new Date(Date.UTC(options.now.getUTCFullYear(), options.now.getUTCMonth(), day))
      .toISOString()
      .slice(0, 10);
    daily.set(key, { day: key, attempts: 0, verified: 0 });
  }
  for (const event of monthlyUsage) {
    const day = daily.get(new Date(event.createdAt).toISOString().slice(0, 10));
    if (day && event.kind === "attempt") day.attempts += amount(event.quantity);
    if (day && event.kind === "verified_submission") day.verified += amount(event.quantity);
  }
  return {
    generatedAt: options.now.toISOString(),
    periodStart: month.toISOString(),
    periodLabel: month.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
    emergencyStop: options.emergencyStop,
    users: data.userCount,
    activeUsers30d: activeIds.size,
    paidSubscribers: paid.length,
    trialSubscribers: data.subscriptions.filter(
      (sub) =>
        sub.plan !== "free" &&
        sub.status === "trialing" &&
        (!sub.periodEnd || safeDate(sub.periodEnd) > now),
    ).length,
    nominalMrrUsd: nominalMrr,
    outcomes: {
      applicationCompletion: metric(
        applicationCohort.filter(hasReceipt).length,
        applicationCohort.length,
      ),
      submissionVerification: metric(
        submissionCohort.filter(hasReceipt).length,
        submissionCohort.length,
      ),
      clarificationFrequency: metric(clarified.size, applicationCohort.length),
      resumeGeneration: metric(
        measuredGenerations.filter((action) => action.details.outcome === "succeeded").length,
        measuredGenerations.length,
      ),
      savedResumeValidation: metric(
        monthlyResumes.filter((resume) => resume.validation.valid).length,
        monthlyResumes.length,
      ),
      meanApplicationCostUsd: applicationCohort.length
        ? cohortCost / applicationCohort.length
        : null,
      applicationCohortRecordedCostUsd: cohortCost,
      applicationCostEstimateComplete:
        (!cohortUsage.some((event) => event.kind === "model") || options.modelPricingConfigured) &&
        (!cohortUsage.some((event) => event.kind === "browser") ||
          options.browserPricingConfigured),
      inProgressApplications: applicationCohort.filter(
        (app) => !hasReceipt(app) && !["failed", "withdrawn", "rejected"].includes(app.status),
      ).length,
      clarificationTelemetryAvailable: data.approvals !== undefined,
    },
    costAlertCount: costAlerts.length,
    costAlerts: costAlerts.slice(0, 50),
    attempts,
    verifiedSubmissions: verified.size,
    failedApplications: monthlyApplications.filter((app) => app.status === "failed").length,
    unverifiedApplications: monthlyApplications.filter(
      (app) => app.status === "submission_unverified",
    ).length,
    averageRuntimeSeconds: durations.length
      ? durations.reduce((sum, value) => sum + value, 0) / durations.length
      : null,
    measuredRuns: durations.length,
    browserMinutes: browser.reduce((sum, event) => sum + amount(event.quantity), 0),
    inputTokens: model.reduce((sum, event) => sum + amount(event.inputTokens || 0), 0),
    outputTokens: model.reduce((sum, event) => sum + amount(event.outputTokens || 0), 0),
    recordedCostUsd: costUsd,
    costPerVerifiedSubmissionUsd: verified.size ? costUsd / verified.size : null,
    costEstimateComplete:
      (!browser.length || options.browserPricingConfigured) &&
      (!model.length || options.modelPricingConfigured),
    retries,
    queueDepth: data.runs.filter((run) => run.status === "queued").length,
    running: data.runs.filter((run) => run.status === "running").length,
    waiting: data.runs.filter((run) => run.status === "waiting").length,
    expiredLeases: data.runs.filter(
      (run) => run.status === "running" && safeDate(run.leaseUntil) < now,
    ).length,
    failureCategories: Object.entries(failureCategories)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    customers: Array.from(costByUser, ([id, metrics]) => ({
      customer: createHash("sha256").update(id).digest("hex").slice(0, 12),
      ...metrics,
    }))
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, 50),
    daily: Array.from(daily.values()),
  };
}
export type AdminSnapshot = ReturnType<typeof aggregateAdmin>;
async function remoteRows<T>(table: string): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabaseService()
      .from(table)
      .select("data")
      .order("created_at")
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    result.push(...(data || []).map((row) => row.data as T));
    if (!data || data.length < 1000) return result;
  }
}
export async function getAdminSnapshot(user: User | null): Promise<AdminSnapshot> {
  requireAdmin(user);
  let data: AdminData;
  if (appMode() === "local") {
    const db = localDb();
    const rows = db
      .prepare(
        "SELECT collection,data FROM records WHERE collection IN('candidate_profiles','applications','agent_runs','usage_events','subscriptions','application_events','approval_requests','generated_resumes','agent_actions')",
      )
      .all() as { collection: string; data: string }[];
    const read = <T>(name: string) =>
      rows.filter((row) => row.collection === name).map((row) => JSON.parse(row.data) as T);
    data = {
      userCount: (
        db.prepare("SELECT count(*)as n FROM local_users").get() as {
          n: number;
        }
      ).n,
      profiles: read("candidate_profiles"),
      applications: read("applications"),
      runs: read("agent_runs"),
      usage: read("usage_events"),
      subscriptions: read("subscriptions"),
      events: read("application_events"),
      approvals: read("approval_requests"),
      resumes: read("generated_resumes"),
      actions: read("agent_actions"),
    };
  } else {
    const [
      users,
      profiles,
      applications,
      runs,
      usage,
      subscriptions,
      events,
      approvals,
      resumes,
      actions,
    ] = await Promise.all([
      supabaseService().from("users").select("id", { count: "exact", head: true }),
      remoteRows<ProfileRecord>("candidate_profiles"),
      remoteRows<Application>("applications"),
      remoteRows<AgentRun>("agent_runs"),
      remoteRows<UsageEvent>("usage_events"),
      remoteRows<Subscription>("subscriptions"),
      remoteRows<AppEvent>("application_events"),
      remoteRows<Approval>("approval_requests"),
      remoteRows<GeneratedResume>("generated_resumes"),
      remoteRows<AuditAction>("agent_actions"),
    ]);
    if (users.error) throw users.error;
    data = {
      userCount: users.count || 0,
      profiles,
      applications,
      runs,
      usage,
      subscriptions,
      events,
      approvals,
      resumes,
      actions,
    };
  }
  const price = (name: string, fallback: number) => {
    const value = Number(process.env[name] ?? fallback);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  const configuredRate = (name: string) => {
    const value = process.env[name];
    return (
      value !== undefined &&
      value.trim() !== "" &&
      Number.isFinite(Number(value)) &&
      Number(value) >= 0
    );
  };
  return aggregateAdmin(data, {
    now: new Date(),
    proMonthlyUsd: price("PLAN_PRO_MONTHLY_USD", 39),
    autonomousMonthlyUsd: price("PLAN_AUTONOMOUS_MONTHLY_USD", 199),
    modelPricingConfigured:
      configuredRate("MODEL_INPUT_USD_PER_MILLION") &&
      configuredRate("MODEL_OUTPUT_USD_PER_MILLION"),
    browserPricingConfigured: configuredRate("BROWSER_USD_PER_MINUTE"),
    emergencyStop:
      process.env.GLOBAL_EMERGENCY_STOP === "true" || process.env.EMERGENCY_STOP === "true",
  });
}
