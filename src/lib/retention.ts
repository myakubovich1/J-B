import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { collections } from "./contracts";
import { appMode, dataDirectory, getStore, localDb, supabaseService } from "./store";
import { deleteArtifact } from "./storage";

const bucket = () => process.env.SUPABASE_STORAGE_BUCKET || "career-artifacts";
export type RetentionReport = {
  operational: Record<string, number>;
  usersScanned: number;
  orphanedArtifactsDeleted: number;
};

/**
 * Remove private artifacts no record references (left by uploads or compiles whose database
 * write failed) and prune expired operational rows. Every artifact the application keeps is
 * referenced by key from one of its owner's records, so an unreferenced object older than the
 * grace period cannot belong to an in-flight operation. Customer records themselves are only
 * removed by account deletion; time-based expiry of customer data needs a policy decision.
 */
export async function runRetention(
  options: { graceHours?: number; now?: number } = {},
): Promise<RetentionReport> {
  const now = options.now ?? Date.now();
  const graceMs = Math.max(1, options.graceHours ?? 24) * 3600 * 1000;
  const operational = await pruneOperational(now);
  let usersScanned = 0,
    orphanedArtifactsDeleted = 0;
  for (const userId of await artifactOwners()) {
    usersScanned++;
    const objects = (await listObjects(userId)).filter((object) => now - object.at > graceMs);
    if (!objects.length) continue;
    const store = getStore();
    let referenced = "";
    for (const collection of collections)
      referenced += JSON.stringify(await store.list(collection, userId));
    for (const object of objects)
      if (!referenced.includes(object.key)) {
        await deleteArtifact(userId, object.key);
        orphanedArtifactsDeleted++;
      }
  }
  return { operational, usersScanned, orphanedArtifactsDeleted };
}

async function pruneOperational(now: number): Promise<Record<string, number>> {
  if (appMode() === "supabase") {
    const { data, error } = await supabaseService().rpc("prune_operational_records", {
      p_webhook_days: 90,
    });
    if (error) throw error;
    return data as Record<string, number>;
  }
  const db = localDb();
  const iso = (ms: number) => new Date(ms).toISOString();
  db.exec(
    "CREATE TABLE IF NOT EXISTS worker_heartbeats(worker_id TEXT PRIMARY KEY,started_at TEXT NOT NULL,beat_at TEXT NOT NULL,lanes INTEGER NOT NULL,busy INTEGER NOT NULL,version TEXT)",
  );
  return {
    sessions: Number(
      db.prepare("DELETE FROM local_sessions WHERE expires_at<?").run(iso(now)).changes,
    ),
    rate_limits: Number(
      db.prepare("DELETE FROM rate_limits WHERE expires_at<?").run(now - 86400000).changes,
    ),
    webhook_events: Number(
      db
        .prepare("DELETE FROM webhook_events WHERE status='processed' AND updated_at<?")
        .run(iso(now - 90 * 86400000)).changes,
    ),
    worker_heartbeats: Number(
      db.prepare("DELETE FROM worker_heartbeats WHERE beat_at<?").run(iso(now - 7 * 86400000))
        .changes,
    ),
  };
}

async function artifactOwners(): Promise<string[]> {
  if (appMode() === "supabase") {
    const owners: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabaseService()
        .storage.from(bucket())
        .list("", { limit: 1000, offset });
      if (error) throw error;
      // Top-level entries without an id are the per-owner folders.
      owners.push(...(data || []).filter((item) => !item.id).map((item) => item.name));
      if (!data || data.length < 1000) return owners;
    }
  }
  try {
    return await readdir(path.join(dataDirectory(), "artifacts"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function listObjects(userId: string): Promise<{ key: string; at: number }[]> {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(userId)) return [];
  if (appMode() === "supabase") {
    const objects: { key: string; at: number }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabaseService()
        .storage.from(bucket())
        .list(userId, { limit: 1000, offset });
      if (error) throw error;
      for (const item of data || [])
        if (item.id)
          objects.push({
            key: `${userId}/${item.name}`,
            at: Date.parse(item.created_at ?? "") || 0,
          });
      if (!data || data.length < 1000) return objects;
    }
  }
  const root = path.join(dataDirectory(), "artifacts", userId);
  const names = await readdir(root).catch(() => [] as string[]);
  return Promise.all(
    names.map(async (name) => ({
      key: `${userId}/${name}`,
      at: (await stat(path.join(root, name))).mtimeMs,
    })),
  );
}
