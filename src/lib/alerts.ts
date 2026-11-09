import { createHash, createHmac } from "node:crypto";

export type AlertSeverity = "info" | "warning" | "critical";
export type OperationalAlert = {
  severity: AlertSeverity;
  /** Stable machine-readable name, e.g. `submission_unverified`. */
  event: string;
  summary: string;
  /** Aggregate or pseudonymous context only: never answers, documents, tokens, or contacts. */
  details?: Record<string, string | number | boolean | null>;
  /** Alerts with the same key are suppressed for `suppressMs` in this process. */
  dedupeKey?: string;
};

const recent = new Map<string, number>();
/** Pseudonymous customer reference for alerts and logs; matches no stored identifier. */
export function customerRef(userId: string): string {
  return createHash("sha256").update(`jb-customer:${userId}`).digest("hex").slice(0, 16);
}
export function alertingConfigured(): boolean {
  return Boolean(process.env.ALERT_WEBHOOK_URL);
}
function log(level: "info" | "error", event: string, extra: Record<string, unknown> = {}) {
  console[level](JSON.stringify({ level, event, ...extra }));
}

/**
 * Deliver an operator alert to `ALERT_WEBHOOK_URL` (Slack-compatible `text` plus structured
 * fields). Bodies are signed with HMAC-SHA256 of `${timestamp}.${body}` in
 * `X-JB-Signature` when `ALERT_WEBHOOK_SECRET` is set. Delivery is best effort with
 * bounded retries; every alert is also written to the structured log, so log-based monitoring
 * still sees it if the webhook is down. Never throws into the caller's workflow.
 */
export async function sendOperationalAlert(
  alert: OperationalAlert,
  options: { suppressMs?: number; attempts?: number } = {},
): Promise<"delivered" | "suppressed" | "logged_only" | "failed"> {
  const key = alert.dedupeKey || `${alert.event}:${alert.summary}`;
  const suppressMs = options.suppressMs ?? 10 * 60 * 1000;
  const now = Date.now();
  if ((recent.get(key) ?? 0) > now - suppressMs) return "suppressed";
  recent.set(key, now);
  if (recent.size > 1000)
    for (const [entry, at] of recent) if (at <= now - suppressMs) recent.delete(entry);
  log(alert.severity === "info" ? "info" : "error", "operational_alert", {
    severity: alert.severity,
    alert: alert.event,
    summary: alert.summary,
    details: alert.details ?? {},
  });
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return "logged_only";
  const environment = process.env.DEPLOYMENT_ENVIRONMENT || process.env.NODE_ENV || "development";
  const body = JSON.stringify({
    text: `[${environment}] ${alert.severity.toUpperCase()} ${alert.event}: ${alert.summary}`,
    severity: alert.severity,
    event: alert.event,
    summary: alert.summary,
    details: alert.details ?? {},
    environment,
    sentAt: new Date(now).toISOString(),
  });
  const timestamp = String(Math.floor(now / 1000));
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-JB-Timestamp": timestamp,
  };
  if (process.env.ALERT_WEBHOOK_SECRET)
    headers["X-JB-Signature"] =
      `sha256=${createHmac("sha256", process.env.ALERT_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest("hex")}`;
  const attempts = Math.max(1, options.attempts ?? 3);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      if (response.ok) return "delivered";
      if (response.status < 500 && response.status !== 429) break;
    } catch {
      /* retried below */
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
  log("error", "alert_delivery_failed", { alert: alert.event });
  return "failed";
}
