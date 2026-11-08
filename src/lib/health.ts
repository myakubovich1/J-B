import { appMode, localDb, supabaseService } from "./store";

export type Heartbeat = {
  workerId: string;
  startedAt: string;
  beatAt: string;
  lanes: number;
  busy: number;
  version: string | null;
};
export type CheckStatus = "ok" | "degraded" | "failed";
export type Readiness = {
  status: CheckStatus;
  checks: { name: string; status: CheckStatus; detail: string }[];
};

/** A worker is stale after missing this many seconds of beats (it beats every 15s). */
export const HEARTBEAT_STALE_SECONDS = 90;

function ensureLocalTable() {
  localDb().exec(
    "CREATE TABLE IF NOT EXISTS worker_heartbeats(worker_id TEXT PRIMARY KEY,started_at TEXT NOT NULL,beat_at TEXT NOT NULL,lanes INTEGER NOT NULL,busy INTEGER NOT NULL,version TEXT)",
  );
}
export async function recordHeartbeat(beat: Omit<Heartbeat, "beatAt">): Promise<void> {
  const beatAt = new Date().toISOString();
  if (appMode() === "supabase") {
    const { error } = await supabaseService().from("worker_heartbeats").upsert({
      worker_id: beat.workerId,
      started_at: beat.startedAt,
      beat_at: beatAt,
      lanes: beat.lanes,
      busy: beat.busy,
      version: beat.version,
    });
    if (error) throw error;
    return;
  }
  ensureLocalTable();
  localDb()
    .prepare(
      "INSERT INTO worker_heartbeats VALUES(?,?,?,?,?,?) ON CONFLICT(worker_id) DO UPDATE SET beat_at=excluded.beat_at,lanes=excluded.lanes,busy=excluded.busy,version=excluded.version",
    )
    .run(beat.workerId, beat.startedAt, beatAt, beat.lanes, beat.busy, beat.version);
}
export async function removeHeartbeat(workerId: string): Promise<void> {
  if (appMode() === "supabase") {
    await supabaseService().from("worker_heartbeats").delete().eq("worker_id", workerId);
    return;
  }
  ensureLocalTable();
  localDb().prepare("DELETE FROM worker_heartbeats WHERE worker_id=?").run(workerId);
}
export async function listHeartbeats(): Promise<Heartbeat[]> {
  if (appMode() === "supabase") {
    const { data, error } = await supabaseService()
      .from("worker_heartbeats")
      .select("worker_id,started_at,beat_at,lanes,busy,version")
      .order("beat_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data || []).map((row) => ({
      workerId: row.worker_id,
      startedAt: row.started_at,
      beatAt: row.beat_at,
      lanes: row.lanes,
      busy: row.busy,
      version: row.version,
    }));
  }
  ensureLocalTable();
  return (
    localDb().prepare("SELECT * FROM worker_heartbeats ORDER BY beat_at DESC LIMIT 50").all() as {
      worker_id: string;
      started_at: string;
      beat_at: string;
      lanes: number;
      busy: number;
      version: string | null;
    }[]
  ).map((row) => ({
    workerId: row.worker_id,
    startedAt: row.started_at,
    beatAt: row.beat_at,
    lanes: row.lanes,
    busy: row.busy,
    version: row.version,
  }));
}

/** Configuration that must never reach a deployed environment. */
export function unsafeConfiguration(env = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];
  const problems: string[] = [];
  if (env.APP_MODE !== "supabase") problems.push("APP_MODE must be supabase");
  if (env.ENABLE_TEST_EMPLOYER === "true") problems.push("test employer fixture is enabled");
  if (!env.APP_URL?.startsWith("https://")) problems.push("APP_URL must be HTTPS");
  if (env.STRIPE_SECRET_KEY?.startsWith("sk_live_") && env.DEPLOYMENT_ENVIRONMENT !== "production")
    problems.push("live Stripe key outside the production environment");
  return problems;
}

export async function readiness(now = Date.now()): Promise<Readiness> {
  const checks: Readiness["checks"] = [];
  try {
    if (appMode() === "supabase") {
      const { error } = await supabaseService()
        .from("users")
        .select("id", { head: true, count: "estimated" })
        .limit(1);
      if (error) throw error;
    } else localDb().prepare("SELECT 1").get();
    checks.push({ name: "database", status: "ok", detail: `${appMode()} persistence reachable` });
  } catch {
    checks.push({ name: "database", status: "failed", detail: "persistence unreachable" });
  }
  const unsafe = (() => {
    try {
      return unsafeConfiguration();
    } catch {
      return ["configuration unreadable"];
    }
  })();
  checks.push({
    name: "configuration",
    status: unsafe.length ? "failed" : "ok",
    detail: unsafe.length ? unsafe.join("; ") : "no unsafe production settings",
  });
  if (checks[0].status === "ok") {
    try {
      const fresh = (await listHeartbeats()).filter(
        (beat) => now - Date.parse(beat.beatAt) < HEARTBEAT_STALE_SECONDS * 1000,
      );
      checks.push({
        name: "worker",
        // Web requests still work without a worker; queued jobs wait. Degraded, not failed.
        status: fresh.length ? "ok" : "degraded",
        detail: fresh.length
          ? `${fresh.length} worker(s) reporting, ${fresh.reduce((n, beat) => n + beat.busy, 0)} busy lane(s)`
          : `no worker heartbeat in ${HEARTBEAT_STALE_SECONDS}s; queued work is not progressing`,
      });
    } catch {
      checks.push({ name: "worker", status: "degraded", detail: "heartbeats unavailable" });
    }
  }
  const stopped =
    process.env.GLOBAL_EMERGENCY_STOP === "true" || process.env.EMERGENCY_STOP === "true";
  checks.push({
    name: "emergency_stop",
    status: stopped ? "degraded" : "ok",
    detail: stopped ? "new side effects are paused" : "not engaged",
  });
  const status: CheckStatus = checks.some((check) => check.status === "failed")
    ? "failed"
    : checks.some((check) => check.status === "degraded")
      ? "degraded"
      : "ok";
  return { status, checks };
}
