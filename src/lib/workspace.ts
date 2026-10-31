import type { User } from "./contracts";
import { emptyProfile } from "./contracts";
import { getStore } from "./store";
import { getPlanState, planLimits, stripeReady } from "./billing";
import { listTemplates } from "./resume";

export async function getWorkspace(user: User) {
  const db = getStore();
  const [
    profiles,
    applications,
    runs,
    events,
    approvals,
    resumes,
    messages,
    sources,
    answers,
    notifications,
    integrations,
    templates,
    billing,
    usage,
  ] = await Promise.all([
    db.list("candidate_profiles", user.id),
    db.list("applications", user.id),
    db.list("agent_runs", user.id),
    db.list("application_events", user.id),
    db.list("approval_requests", user.id),
    db.list("generated_resumes", user.id),
    db.list("messages", user.id),
    db.list("job_sources", user.id),
    db.list("screening_answers", user.id),
    db.list("notifications", user.id),
    db.list("integration_connections", user.id),
    listTemplates(user.id),
    getPlanState(user.id),
    db.list("usage_events", user.id),
  ]);
  const profile = profiles[0]?.profile ?? emptyProfile(user.email, user.name);
  const sort = <T extends { createdAt: string }>(arr: T[]) =>
    arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    user,
    profile,
    profileVersion: profiles[0]?.version ?? 0,
    applications: sort(applications).reverse(),
    runs,
    events: sort(events),
    approvals: sort(approvals),
    resumes: sort(resumes).reverse(),
    messages: sort(messages),
    sources,
    answers,
    notifications,
    integrations: integrations.map((i) => ({ ...i, secretRef: null })),
    templates,
    billing,
    pricing: {
      limits: planLimits(),
      pro: Number(process.env.PLAN_PRO_MONTHLY_USD || 39),
      autonomous: Number(process.env.PLAN_AUTONOMOUS_MONTHLY_USD || 199),
    },
    usage: {
      attempts: usage.filter((u) => u.kind === "attempt").length,
      inputTokens: usage.reduce((a, b) => a + (b.inputTokens ?? 0), 0),
      outputTokens: usage.reduce((a, b) => a + (b.outputTokens ?? 0), 0),
      costUsd: usage.reduce((a, b) => a + b.costUsd, 0),
      browserSeconds: usage
        .filter((u) => u.kind === "browser")
        .reduce((a, b) => a + b.quantity * 60, 0),
      retries: usage.filter((u) => u.kind === "retry").length,
      costConfigured: Boolean(
        process.env.MODEL_INPUT_USD_PER_MILLION &&
        process.env.MODEL_OUTPUT_USD_PER_MILLION &&
        process.env.BROWSER_USD_PER_MINUTE,
      ),
    },
    capabilities: {
      mode: process.env.APP_MODE === "supabase" ? "supabase" : "local",
      ai: Boolean(
        process.env.OPENAI_API_KEY &&
        (process.env.OPENAI_MODEL_CHAT || process.env.OPENAI_MODEL_EXTRACTION),
      ),
      billing: stripeReady(),
      browserbase: Boolean(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID),
      testEmployer:
        process.env.ENABLE_TEST_EMPLOYER === "true" &&
        process.env.APP_MODE !== "supabase" &&
        process.env.NODE_ENV !== "production",
      githubOAuth: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      gmail: Boolean(
        process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.EMAIL_OAUTH_APPROVED === "true",
      ),
      outlook: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
      emergencyStop:
        process.env.EMERGENCY_STOP === "true" || process.env.GLOBAL_EMERGENCY_STOP === "true",
      admin: (process.env.ADMIN_USER_IDS || "")
        .split(",")
        .map((s) => s.trim())
        .includes(user.id),
    },
  };
}
export type Workspace = Awaited<ReturnType<typeof getWorkspace>>;
