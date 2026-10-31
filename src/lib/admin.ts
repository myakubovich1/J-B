import { createHash } from "node:crypto";
import type {
  AgentRun,
  Application,
  AppEvent,
  ProfileRecord,
  Subscription,
  UsageEvent,
  User,
} from "./contracts";
import { appMode, localDb, supabaseService } from "./store";

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
        "SELECT collection,data FROM records WHERE collection IN('candidate_profiles','applications','agent_runs','usage_events','subscriptions','application_events')",
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
    };
  } else {
    const [users, profiles, applications, runs, usage, subscriptions, events] = await Promise.all([
      supabaseService().from("users").select("id", { count: "exact", head: true }),
      remoteRows<ProfileRecord>("candidate_profiles"),
      remoteRows<Application>("applications"),
      remoteRows<AgentRun>("agent_runs"),
      remoteRows<UsageEvent>("usage_events"),
      remoteRows<Subscription>("subscriptions"),
      remoteRows<AppEvent>("application_events"),
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
