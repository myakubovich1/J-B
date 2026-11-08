import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  collections,
  entity,
  type AgentRun,
  type Collection,
  type Records,
  type UsageEvent,
} from "./contracts";

export interface Store {
  list<K extends Collection>(collection: K, userId: string): Promise<Records[K][]>;
  get<K extends Collection>(collection: K, id: string, userId: string): Promise<Records[K] | null>;
  save<K extends Collection>(collection: K, record: Records[K]): Promise<Records[K]>;
  createIfAbsent<K extends Collection>(collection: K, record: Records[K]): Promise<Records[K]>;
  remove(collection: Collection, id: string, userId: string): Promise<void>;
  claimRun(workerId?: string): Promise<AgentRun | null>;
  reserveSubmission(userId: string, applicationId: string, limit: number): Promise<boolean>;
  recordVerifiedSubmission(userId: string, applicationId: string): Promise<void>;
  releaseSubmission(userId: string, applicationId: string): Promise<void>;
}

export function appMode(): "local" | "supabase" {
  if (process.env.APP_MODE === "supabase") return "supabase";
  if (process.env.NODE_ENV === "production" && process.env.APP_MODE !== "local")
    throw new Error("Set APP_MODE=supabase for deployment. Local mode must be explicitly enabled.");
  return "local";
}
export function dataDirectory(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || ".data");
}
const dbs = new Map<string, DatabaseSync>();
export function localDb(): DatabaseSync {
  const filename = path.join(dataDirectory(), "career.db");
  const cached = dbs.get(filename);
  if (cached) return cached;
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  for (const ownedFile of [filename, `${filename}-wal`, `${filename}-shm`])
    if (existsSync(/* turbopackIgnore: true */ ownedFile))
      chmodSync(/* turbopackIgnore: true */ ownedFile, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS records(collection TEXT NOT NULL,id TEXT NOT NULL,user_id TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(collection,id));
    CREATE INDEX IF NOT EXISTS records_owner ON records(collection,user_id,created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS one_profile ON records(user_id) WHERE collection='candidate_profiles';
    CREATE UNIQUE INDEX IF NOT EXISTS one_subscription ON records(user_id) WHERE collection='subscriptions';
    CREATE UNIQUE INDEX IF NOT EXISTS application_url ON records(user_id,json_extract(data,'$.jobUrl')) WHERE collection='applications';
    CREATE TABLE IF NOT EXISTS local_users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS local_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,hits INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY,status TEXT NOT NULL,updated_at TEXT NOT NULL);
  `);
  dbs.set(filename, db);
  return db;
}

function checkCollection(collection: string): asserts collection is Collection {
  if (!collections.includes(collection as Collection)) throw new Error("Unknown collection");
}
function parseRow<K extends Collection>(row: { data: string } | undefined): Records[K] | null {
  return row ? (JSON.parse(row.data) as Records[K]) : null;
}
/** Queue lease length, bounded like the SQL claim function (30-900 s). */
export function leaseSeconds(): number {
  const value = Number(process.env.WORKER_LEASE_SECONDS || 600);
  return Number.isFinite(value) ? Math.min(900, Math.max(30, value)) : 600;
}
export function utcMonthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export class LocalStore implements Store {
  private get db() {
    return localDb();
  }
  async list<K extends Collection>(collection: K, userId: string): Promise<Records[K][]> {
    checkCollection(collection);
    return (
      this.db
        .prepare(
          "SELECT data FROM records WHERE collection=? AND user_id=? ORDER BY created_at DESC",
        )
        .all(collection, userId) as { data: string }[]
    ).map((row) => JSON.parse(row.data) as Records[K]);
  }
  async get<K extends Collection>(
    collection: K,
    id: string,
    userId: string,
  ): Promise<Records[K] | null> {
    checkCollection(collection);
    return parseRow<K>(
      this.db
        .prepare("SELECT data FROM records WHERE collection=? AND id=? AND user_id=?")
        .get(collection, id, userId) as { data: string } | undefined,
    );
  }
  async save<K extends Collection>(collection: K, record: Records[K]): Promise<Records[K]> {
    checkCollection(collection);
    if (!record.id || !record.userId) throw new Error("Record ownership is required");
    const updated = { ...record, updatedAt: new Date().toISOString() };
    const result = this.db
      .prepare(
        `INSERT INTO records(collection,id,user_id,data,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at WHERE records.user_id=excluded.user_id`,
      )
      .run(
        collection,
        updated.id,
        updated.userId,
        JSON.stringify(updated),
        updated.createdAt,
        updated.updatedAt,
      );
    if (!result.changes) throw new Error("Record belongs to another user");
    return updated;
  }
  async createIfAbsent<K extends Collection>(
    collection: K,
    record: Records[K],
  ): Promise<Records[K]> {
    checkCollection(collection);
    if (!record.id || !record.userId) throw new Error("Record ownership is required");
    this.db
      .prepare(
        "INSERT INTO records(collection,id,user_id,data,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING",
      )
      .run(
        collection,
        record.id,
        record.userId,
        JSON.stringify(record),
        record.createdAt,
        record.updatedAt,
      );
    const existing = await this.get(collection, record.id, record.userId);
    if (!existing) throw new Error("Record collision or ownership conflict");
    return existing;
  }
  async remove(collection: Collection, id: string, userId: string): Promise<void> {
    checkCollection(collection);
    this.db
      .prepare("DELETE FROM records WHERE collection=? AND id=? AND user_id=?")
      .run(collection, id, userId);
  }
  async claimRun(_workerId?: string): Promise<AgentRun | null> {
    const db = this.db;
    const now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      const exhausted = db
        .prepare(
          "SELECT data FROM records WHERE collection='agent_runs' AND json_extract(data,'$.status')='running' AND json_extract(data,'$.leaseUntil')<=? AND json_extract(data,'$.attempts')>=json_extract(data,'$.maxAttempts')",
        )
        .all(now) as { data: string }[];
      for (const row of exhausted) {
        const run = JSON.parse(row.data) as AgentRun;
        const appRow = db
          .prepare(
            "SELECT data FROM records WHERE collection='applications' AND id=? AND user_id=?",
          )
          .get(run.applicationId, run.userId) as { data: string } | undefined;
        const app = appRow ? (JSON.parse(appRow.data) as Records["applications"]) : null;
        const uncertain = Boolean(app?.submissionStartedAt && !app.receipt);
        const message = uncertain
          ? "Worker lease expired after submission began. Verify the portal receipt before continuing."
          : "Worker lease expired after maximum attempts";
        const stopped = {
          ...run,
          status: uncertain ? "waiting" : "failed",
          stage: uncertain ? "needs_input" : "failed",
          leaseUntil: null,
          error: message,
          updatedAt: now,
        };
        db.prepare(
          "UPDATE records SET data=?,updated_at=? WHERE collection='agent_runs' AND id=? AND user_id=?",
        ).run(JSON.stringify(stopped), now, run.id, run.userId);
        if (app && !app.receipt) {
          const updated = {
            ...app,
            status: uncertain ? "submission_unverified" : "failed",
            error: message,
            updatedAt: now,
          };
          db.prepare(
            "UPDATE records SET data=?,updated_at=? WHERE collection='applications' AND id=? AND user_id=?",
          ).run(JSON.stringify(updated), now, app.id, app.userId);
        }
      }
      const running = db
        .prepare(
          "SELECT count(*) AS n FROM records WHERE collection='agent_runs' AND json_extract(data,'$.status')='running' AND json_extract(data,'$.leaseUntil')>?",
        )
        .get(now) as { n: number };
      if (running.n >= Number(process.env.WORKER_CONCURRENCY || 2)) {
        db.exec("COMMIT");
        return null;
      }
      const row = db
        .prepare(
          `SELECT candidate.data FROM records candidate WHERE candidate.collection='agent_runs' AND json_extract(candidate.data,'$.attempts') < json_extract(candidate.data,'$.maxAttempts') AND ((json_extract(candidate.data,'$.status')='queued' AND json_extract(candidate.data,'$.nextAttemptAt')<=?) OR (json_extract(candidate.data,'$.status')='running' AND json_extract(candidate.data,'$.leaseUntil')<=?)) AND NOT EXISTS(SELECT 1 FROM records peer WHERE peer.collection='agent_runs' AND peer.user_id=candidate.user_id AND peer.id<>candidate.id AND json_extract(peer.data,'$.status')='running' AND json_extract(peer.data,'$.leaseUntil')>?) ORDER BY candidate.created_at LIMIT 1`,
        )
        .get(now, now, now) as { data: string } | undefined;
      if (!row) {
        db.exec("COMMIT");
        return null;
      }
      const run = JSON.parse(row.data) as AgentRun;
      const next: AgentRun = {
        ...run,
        status: "running",
        attempts: run.attempts + 1,
        leaseUntil: new Date(Date.now() + leaseSeconds() * 1000).toISOString(),
        startedAt: run.startedAt || now,
        updatedAt: now,
      };
      db.prepare(
        "UPDATE records SET data=?,updated_at=? WHERE collection='agent_runs' AND id=? AND user_id=?",
      ).run(JSON.stringify(next), now, next.id, next.userId);
      db.exec("COMMIT");
      return next;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  async reserveSubmission(userId: string, applicationId: string, limit: number): Promise<boolean> {
    if (!Number.isInteger(limit) || limit < 0) throw new Error("Invalid submission quota");
    const db = this.db;
    db.exec("BEGIN IMMEDIATE");
    try {
      const app = db
        .prepare("SELECT 1 FROM records WHERE collection='applications' AND id=? AND user_id=?")
        .get(applicationId, userId);
      if (!app) throw new Error("Application not found");
      const rows = db
        .prepare(
          "SELECT data FROM records WHERE collection='usage_events' AND user_id=? AND created_at>=?",
        )
        .all(userId, utcMonthStart()) as { data: string }[];
      const events = rows
        .map((x) => JSON.parse(x.data) as UsageEvent)
        .filter((x) => x.kind === "reservation" || x.kind === "verified_submission");
      if (events.some((x) => x.applicationId === applicationId)) {
        db.exec("COMMIT");
        return true;
      }
      const count = new Set(events.map((x) => x.applicationId)).size;
      if (count >= limit) {
        db.exec("COMMIT");
        return false;
      }
      const event: UsageEvent = {
        ...entity(userId),
        kind: "reservation",
        applicationId,
        quantity: 1,
        costUsd: 0,
      };
      db.prepare("INSERT INTO records VALUES(?,?,?,?,?,?)").run(
        "usage_events",
        event.id,
        userId,
        JSON.stringify(event),
        event.createdAt,
        event.updatedAt,
      );
      db.exec("COMMIT");
      return true;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  async recordVerifiedSubmission(userId: string, applicationId: string): Promise<void> {
    const db = this.db;
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db
        .prepare("SELECT data FROM records WHERE collection='applications' AND id=? AND user_id=?")
        .get(applicationId, userId) as { data: string } | undefined;
      const app = row ? (JSON.parse(row.data) as Records["applications"]) : null;
      if (!app?.receipt?.verifiedAt)
        throw new Error("Verifiable receipt required before recording submission usage");
      const existing = db
        .prepare(
          "SELECT id FROM records WHERE collection='usage_events' AND user_id=? AND json_extract(data,'$.applicationId')=? AND json_extract(data,'$.kind')='verified_submission'",
        )
        .get(userId, applicationId);
      if (!existing) {
        db.prepare(
          "DELETE FROM records WHERE collection='usage_events' AND user_id=? AND json_extract(data,'$.applicationId')=? AND json_extract(data,'$.kind')='reservation'",
        ).run(userId, applicationId);
        const event: UsageEvent = {
          ...entity(userId),
          kind: "verified_submission",
          applicationId,
          quantity: 1,
          costUsd: 0,
        };
        db.prepare("INSERT INTO records VALUES(?,?,?,?,?,?)").run(
          "usage_events",
          event.id,
          userId,
          JSON.stringify(event),
          event.createdAt,
          event.updatedAt,
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  async releaseSubmission(userId: string, applicationId: string): Promise<void> {
    const app = await this.get("applications", applicationId, userId);
    if (app?.submissionStartedAt) return;
    this.db
      .prepare(
        "DELETE FROM records WHERE collection='usage_events' AND user_id=? AND json_extract(data,'$.applicationId')=? AND json_extract(data,'$.kind')='reservation'",
      )
      .run(userId, applicationId);
  }
}

let serviceClient: SupabaseClient | undefined;
export function supabaseService(): SupabaseClient {
  if (serviceClient) return serviceClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase database is not configured");
  serviceClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return serviceClient;
}
export class SupabaseStore implements Store {
  async createIfAbsent<K extends Collection>(
    collection: K,
    record: Records[K],
  ): Promise<Records[K]> {
    checkCollection(collection);
    if (!record.id || !record.userId) throw new Error("Record ownership is required");
    const { error } = await supabaseService().from(collection).insert({
      id: record.id,
      user_id: record.userId,
      data: record,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });
    if (error && error.code !== "23505") throw error;
    const existing = await this.get(collection, record.id, record.userId);
    if (!existing) throw new Error("Record collision or ownership conflict");
    return existing;
  }
  async list<K extends Collection>(collection: K, userId: string): Promise<Records[K][]> {
    checkCollection(collection);
    const result: Records[K][] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabaseService()
        .from(collection)
        .select("data")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .order("id")
        .range(offset, offset + 999);
      if (error) throw error;
      result.push(...(data || []).map((row) => row.data as Records[K]));
      if (!data || data.length < 1000) return result;
    }
  }
  async get<K extends Collection>(
    collection: K,
    id: string,
    userId: string,
  ): Promise<Records[K] | null> {
    checkCollection(collection);
    const { data, error } = await supabaseService()
      .from(collection)
      .select("data")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return (data?.data as Records[K]) || null;
  }
  async save<K extends Collection>(collection: K, record: Records[K]): Promise<Records[K]> {
    checkCollection(collection);
    const next = { ...record, updatedAt: new Date().toISOString() };
    const { data, error } = await supabaseService().rpc("save_owned_record", {
      p_table: collection,
      p_id: record.id,
      p_user_id: record.userId,
      p_data: next,
    });
    if (error) throw error;
    return data as Records[K];
  }
  async remove(collection: Collection, id: string, userId: string): Promise<void> {
    checkCollection(collection);
    const { error } = await supabaseService()
      .from(collection)
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw error;
  }
  async claimRun(workerId?: string): Promise<AgentRun | null> {
    const { data, error } = await supabaseService().rpc("claim_agent_run", {
      p_worker_id: workerId || "worker",
      p_lease_seconds: leaseSeconds(),
      p_concurrency: Number(process.env.WORKER_CONCURRENCY || 2),
    });
    if (error) throw error;
    return data as AgentRun | null;
  }
  async reserveSubmission(userId: string, applicationId: string, limit: number): Promise<boolean> {
    const { data, error } = await supabaseService().rpc("reserve_submission", {
      p_user_id: userId,
      p_application_id: applicationId,
      p_limit: limit,
    });
    if (error) throw error;
    return data === true;
  }
  async recordVerifiedSubmission(userId: string, applicationId: string): Promise<void> {
    const { error } = await supabaseService().rpc("record_verified_submission", {
      p_user_id: userId,
      p_application_id: applicationId,
    });
    if (error) throw error;
  }
  async releaseSubmission(userId: string, applicationId: string): Promise<void> {
    const { error } = await supabaseService().rpc("release_submission", {
      p_user_id: userId,
      p_application_id: applicationId,
    });
    if (error) throw error;
  }
}
const localStore = new LocalStore();
const remoteStore = new SupabaseStore();
export function getStore(): Store {
  return appMode() === "supabase" ? remoteStore : localStore;
}
