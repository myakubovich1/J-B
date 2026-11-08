import { createHash } from "node:crypto";
import { entity, type AuditAction, type UsageEvent } from "./contracts";
import { getStore } from "./store";
import { customerRef, sendOperationalAlert } from "./alerts";

const validCost = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);
const stableId = (value: string) => {
  const hash = createHash("sha256").update(value).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
function configuredRate(name: string): boolean {
  const value = process.env[name];
  return (
    value !== undefined &&
    value.trim() !== "" &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0
  );
}
export function pricingComplete(usage: UsageEvent[]): boolean {
  return (
    (!usage.some((event) => event.kind === "model") ||
      (configuredRate("MODEL_INPUT_USD_PER_MILLION") &&
        configuredRate("MODEL_OUTPUT_USD_PER_MILLION"))) &&
    (!usage.some((event) => event.kind === "browser") || configuredRate("BROWSER_USD_PER_MINUTE"))
  );
}
function setting(name: string, fallback: number, min = 0, max = 1_000_000): number {
  const value = process.env[name];
  const parsed = value === undefined || !value.trim() ? fallback : Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export type CostAlertKind = "expensive_application" | "monthly_budget" | "pricing_incomplete";
export type CostAlert = {
  kind: CostAlertKind;
  recordedCostUsd: number;
  thresholdUsd: number | null;
  estimateComplete: boolean;
};

/** Strict projection for the operator view: never serialize arbitrary audit details. */
export function readCostAlert(action: AuditAction): CostAlert | null {
  if (action.action !== "execution_cost_alert") return null;
  const { kind, recordedCostUsd, thresholdUsd, estimateComplete } = action.details;
  if (
    typeof kind !== "string" ||
    !["expensive_application", "monthly_budget", "pricing_incomplete"].includes(kind) ||
    typeof recordedCostUsd !== "number" ||
    !Number.isFinite(recordedCostUsd) ||
    recordedCostUsd < 0 ||
    (thresholdUsd !== null &&
      (typeof thresholdUsd !== "number" || !Number.isFinite(thresholdUsd) || thresholdUsd < 0)) ||
    typeof estimateComplete !== "boolean"
  )
    return null;
  if (kind === "pricing_incomplete" ? thresholdUsd !== null : thresholdUsd === null) return null;
  return {
    kind: kind as CostAlertKind,
    recordedCostUsd,
    thresholdUsd: thresholdUsd as number | null,
    estimateComplete,
  };
}

/** A completed attempt includes compilation and PDF validation; failed attempts remain measurable. */
export async function recordResumeGeneration(
  userId: string,
  attemptId: string,
  outcome: { succeeded: boolean; applicationId?: string | null },
): Promise<void> {
  const store = getStore();
  const applicationId = outcome.applicationId || null;
  if (applicationId && !(await store.get("applications", applicationId, userId)))
    throw new Error("Resume generation application is unavailable.");
  await store.createIfAbsent("agent_actions", {
    ...entity(userId, stableId(`resume-generation:${userId}:${attemptId}`)),
    action: "resume_generation_measured",
    applicationId,
    details: { outcome: outcome.succeeded ? "succeeded" : "failed" },
  });
}

/**
 * Call after durable usage writes (worker finally and chat finally). Each signal is one alert per
 * application, or per user/UTC month. Repeated calls heal a partially written notification.
 * These are recorded-cost alerts, not provider invoice reconciliation or external delivery.
 */
export async function evaluateCostAlerts(
  userId: string,
  applicationId?: string | null,
  options: { now?: Date } = {},
): Promise<number> {
  const store = getStore();
  const now = options.now || new Date();
  const month = now.toISOString().slice(0, 7);
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const usage = (await store.list("usage_events", userId)).filter((event) => {
    const at = Date.parse(event.createdAt);
    return event.userId === userId && Number.isFinite(at) && at <= now.getTime();
  });
  const monthly = usage.filter((event) => Date.parse(event.createdAt) >= start);
  const monthlyCost = monthly.reduce((sum, event) => sum + validCost(event.costUsd), 0);
  const complete = pricingComplete(monthly);
  const signals: {
    scope: string;
    alert: CostAlert;
    applicationId: string | null;
  }[] = [];
  const money = (value: number) => `$${value.toFixed(2)}`;
  const incomplete = " Unit prices are incomplete, so recorded costs may understate actual costs.";
  if (!complete)
    signals.push({
      scope: month,
      alert: {
        kind: "pricing_incomplete",
        recordedCostUsd: monthlyCost,
        thresholdUsd: null,
        estimateComplete: false,
      },
      applicationId: null,
    });
  const budget = setting("PER_USER_MONTHLY_BUDGET_USD", 100);
  const ratio = setting("MONTHLY_BUDGET_ALERT_RATIO", 0.8, 0.01, 1);
  if (monthlyCost > 0 && monthlyCost >= budget * ratio)
    signals.push({
      scope: month,
      alert: {
        kind: "monthly_budget",
        recordedCostUsd: monthlyCost,
        thresholdUsd: budget * ratio,
        estimateComplete: complete,
      },
      applicationId: null,
    });
  const threshold = setting("EXPENSIVE_APPLICATION_ALERT_USD", 5);
  if (applicationId && threshold > 0 && (await store.get("applications", applicationId, userId))) {
    const applicationUsage = usage.filter((event) => event.applicationId === applicationId);
    const applicationCost = applicationUsage.reduce(
      (sum, event) => sum + validCost(event.costUsd),
      0,
    );
    const applicationComplete = pricingComplete(applicationUsage);
    if (applicationCost >= threshold)
      signals.push({
        scope: applicationId,
        alert: {
          kind: "expensive_application",
          recordedCostUsd: applicationCost,
          thresholdUsd: threshold,
          estimateComplete: applicationComplete,
        },
        applicationId,
      });
  }
  for (const signal of signals) {
    const key = `cost-alert:${userId}:${signal.alert.kind}:${signal.scope}`;
    // The durable record deduplicates; only its first creation is forwarded to operators.
    if (
      signal.alert.kind !== "pricing_incomplete" &&
      !(await store.get("agent_actions", stableId(key), userId))
    )
      await sendOperationalAlert({
        severity: "warning",
        event: `cost_${signal.alert.kind}`,
        summary: `Recorded execution cost $${signal.alert.recordedCostUsd.toFixed(2)} crossed the $${signal.alert.thresholdUsd?.toFixed(2)} threshold.`,
        details: {
          customer: customerRef(userId),
          estimateComplete: signal.alert.estimateComplete,
        },
        dedupeKey: key,
      });
    await store.createIfAbsent("agent_actions", {
      ...entity(userId, stableId(key)),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      action: "execution_cost_alert",
      applicationId: signal.applicationId,
      details: signal.alert,
    });
  }
  // Reconcile all of this user's saved alerts, including a previous application's incomplete
  // delivery. No old context has to run again for its notification to recover.
  for (const action of await store.list("agent_actions", userId)) {
    const first = readCostAlert(action);
    if (!first) continue;
    const title = {
      pricing_incomplete: "Execution pricing needs configuration",
      monthly_budget: "Monthly execution budget threshold reached",
      expensive_application: "Application execution cost threshold reached",
    }[first.kind];
    const body =
      first.kind === "pricing_incomplete"
        ? "Model or browser activity has been recorded without all configured unit prices. Ask the operator to configure prices before using cost estimates for budget decisions."
        : `Recorded execution costs reached ${money(first.recordedCostUsd)}, crossing the configured ${money(first.thresholdUsd!)} alert threshold.${first.kind === "expensive_application" ? " Includes preparation and retry costs." : " This observation uses the UTC monthly budget window."}${first.estimateComplete ? "" : incomplete}`;
    await store.createIfAbsent("notifications", {
      ...entity(userId, stableId(`cost-alert-notification:${action.id}`)),
      createdAt: action.createdAt,
      updatedAt: action.createdAt,
      title,
      body,
      read: false,
      applicationId: action.applicationId,
    });
  }
  return signals.length;
}
