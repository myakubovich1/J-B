import { hostname } from "node:os";
import { runOnce } from "../src/lib/agent";
import { sendOperationalAlert } from "../src/lib/alerts";
import { recordHeartbeat, removeHeartbeat } from "../src/lib/health";
import { runRetention } from "../src/lib/retention";

const concurrency = Math.min(4, Math.max(1, Number(process.env.WORKER_CONCURRENCY || 1)));
const pollMs = Math.min(10000, Math.max(250, Number(process.env.WORKER_POLL_MS || 1500)));
const leaseMs = Math.min(900, Math.max(30, Number(process.env.WORKER_LEASE_SECONDS || 600))) * 1000;
const retentionHours = Number(process.env.RETENTION_INTERVAL_HOURS ?? 6);
const workerId = `${hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
const startedAt = new Date().toISOString();
const iterationStarted: (number | null)[] = Array.from({ length: concurrency }, () => null);
let stopping = false,
  consecutiveFailures = 0;

// Avoid logging records, URLs, browser tokens, prompts, or candidate data.
const log = (level: "info" | "error", event: string, extra: Record<string, unknown> = {}) =>
  console[level](JSON.stringify({ level, event, worker: workerId, ...extra }));

async function lane(index: number): Promise<void> {
  while (!stopping) {
    iterationStarted[index] = Date.now();
    try {
      const worked = await runOnce();
      consecutiveFailures = 0;
      iterationStarted[index] = null;
      if (!worked) await new Promise((resolve) => setTimeout(resolve, pollMs));
    } catch (error) {
      iterationStarted[index] = null;
      consecutiveFailures++;
      log("error", "worker_iteration_failed", {
        category: error instanceof Error ? error.name : "unknown",
        consecutiveFailures,
      });
      if (consecutiveFailures >= 5)
        void sendOperationalAlert({
          severity: "critical",
          event: "worker_failing",
          summary: `Worker iterations failed ${consecutiveFailures} times in a row; queued work is not progressing.`,
          details: { worker: workerId, category: error instanceof Error ? error.name : "unknown" },
          dedupeKey: `worker_failing:${workerId}`,
        });
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

/**
 * A run's queue lease lets another worker reclaim it once expired. A lane still working past
 * its lease could then act twice, so the process exits first and lets the supervisor restart
 * it. A crash after the submission latch resolves to `submission_unverified`, never a retry.
 */
const watchdog = setInterval(() => {
  const deadline = Date.now() - Math.max(leaseMs * 0.8, leaseMs - 30000);
  if (!iterationStarted.some((at) => at !== null && at < deadline)) return;
  log("error", "worker_watchdog_exit", { leaseSeconds: leaseMs / 1000 });
  void sendOperationalAlert({
    severity: "critical",
    event: "worker_watchdog_exit",
    summary: "A worker step outlived its queue lease; the worker exited for supervisor restart.",
    details: { worker: workerId },
  }).finally(() => process.exit(70));
}, 5000);

async function beat(): Promise<void> {
  await recordHeartbeat({
    workerId,
    startedAt,
    lanes: concurrency,
    busy: iterationStarted.filter((at) => at !== null).length,
    version: process.env.APP_VERSION || null,
  }).catch(() => log("error", "worker_heartbeat_failed"));
}
const heartbeat = setInterval(() => void beat(), 15000);

async function retention(): Promise<void> {
  try {
    log("info", "retention_completed", { ...(await runRetention()) });
  } catch (error) {
    log("error", "retention_failed", { category: error instanceof Error ? error.name : "unknown" });
  }
}
const timers: NodeJS.Timeout[] = [];
if (retentionHours > 0) {
  // Jitter the first pass so a fleet restart does not scan storage simultaneously.
  timers.push(setTimeout(() => void retention(), 60000 + Math.random() * 540000));
  timers.push(setInterval(() => void retention(), retentionHours * 3600 * 1000));
}

let signals = 0;
function shutdown() {
  stopping = true;
  if (++signals > 1) process.exit(1);
  log("info", "worker_stopping");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

log("info", "worker_started", { concurrency });
if (process.env.GLOBAL_EMERGENCY_STOP === "true" || process.env.EMERGENCY_STOP === "true")
  void sendOperationalAlert({
    severity: "warning",
    event: "emergency_stop_engaged",
    summary: "Worker started with the global emergency stop engaged; no jobs will run.",
    details: { worker: workerId },
  });
void beat();
void Promise.all(Array.from({ length: concurrency }, (_, index) => lane(index))).then(async () => {
  clearInterval(watchdog);
  clearInterval(heartbeat);
  timers.forEach((timer) => clearTimeout(timer));
  await removeHeartbeat(workerId).catch(() => undefined);
  log("info", "worker_stopped");
});
