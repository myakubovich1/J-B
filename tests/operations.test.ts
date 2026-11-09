import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, readdir, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string | { name: string }) =>
      jar.delete(typeof name === "string" ? name : name.name),
  }),
}));
import { entity, type User } from "../src/lib/contracts";
import { dataDirectory, getStore, localDb } from "../src/lib/store";
import { getSecret, setSecret } from "../src/lib/secrets";
import { writeArtifact } from "../src/lib/storage";
import { deleteAccount, exportAccount, signOutEverywhere } from "../src/lib/account";
import { readiness, recordHeartbeat, unsafeConfiguration } from "../src/lib/health";
import { runRetention } from "../src/lib/retention";
import { sendOperationalAlert } from "../src/lib/alerts";
import { GET as ready } from "../src/app/api/ready/route";

const person = (name: string): User => ({
  id: crypto.randomUUID(),
  email: `${name}@example.test`,
  name,
});
function addLocalUser(user: User, sessions: string[]) {
  const db = localDb();
  db.prepare(
    "INSERT INTO local_users(id,email,name,password_hash,created_at)VALUES(?,?,?,?,?)",
  ).run(user.id, user.email, user.name, "scrypt$x$y", new Date().toISOString());
  for (const token of sessions)
    db.prepare("INSERT INTO local_sessions(token_hash,user_id,expires_at)VALUES(?,?,?)").run(
      token,
      user.id,
      new Date(Date.now() + 86400000).toISOString(),
    );
}
const sessions = (user: User) =>
  (
    localDb().prepare("SELECT count(*) AS n FROM local_sessions WHERE user_id=?").get(user.id) as {
      n: number;
    }
  ).n;
const run = (user: User, status: string, leaseUntil: string | null = null) => ({
  ...entity(user.id),
  applicationId: "",
  kind: "application" as const,
  status: status as never,
  stage: "reading_job" as const,
  attempts: 0,
  maxAttempts: 3,
  leaseUntil,
  nextAttemptAt: new Date().toISOString(),
  error: null,
  approved: false,
  submitted: false,
});

beforeEach(() => {
  jar.clear();
  process.env.APP_MODE = "local";
  process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "career-operations-"));
  process.env.GITHUB_CLIENT_ID = "fixture-client";
  process.env.GITHUB_CLIENT_SECRET = "fixture-secret";
  delete process.env.ALERT_WEBHOOK_URL;
  delete process.env.ALERT_WEBHOOK_SECRET;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("account data rights", () => {
  it("exports only the owner's records without credential references", async () => {
    const owner = person("owner"),
      other = person("other"),
      store = getStore();
    const secretRef = await setSecret(owner.id, "integration:github", "gho_secret_token");
    await store.save("integration_connections", {
      ...entity(owner.id),
      provider: "github",
      status: "connected",
      account: "owner-gh",
      scopes: ["repo"],
      secretRef,
    });
    await store.save("notifications", {
      ...entity(other.id),
      title: "Other tenant",
      body: "private",
      read: false,
      applicationId: null,
    });
    const key = await writeArtifact(
      owner.id,
      "resume.pdf",
      Buffer.from("%PDF-"),
      "application/pdf",
    );
    const exported = await exportAccount(owner);
    const text = JSON.stringify(exported);
    expect(exported.account.email).toBe(owner.email);
    expect(exported.records.integration_connections).toHaveLength(1);
    expect(exported.artifacts).toEqual([key]);
    expect(text).not.toContain(secretRef);
    expect(text).not.toContain("gho_secret_token");
    expect(text).not.toContain("Other tenant");
  });

  it("deletes one account completely, revokes grants, and leaves other tenants intact", async () => {
    const owner = person("leaving"),
      other = person("staying"),
      store = getStore();
    addLocalUser(owner, ["owner-a", "owner-b"]);
    addLocalUser(other, ["other-a"]);
    const ownerSecret = await setSecret(owner.id, "integration:github", "gho_owner");
    const otherSecret = await setSecret(other.id, "integration:github", "gho_other");
    await store.save("integration_connections", {
      ...entity(owner.id),
      provider: "github",
      status: "connected",
      account: "leaving-gh",
      scopes: ["repo"],
      secretRef: ownerSecret,
    });
    await writeArtifact(owner.id, "resume.pdf", Buffer.from("%PDF-"), "application/pdf");
    const otherKey = await writeArtifact(
      other.id,
      "r.pdf",
      Buffer.from("%PDF-"),
      "application/pdf",
    );
    await store.save("agent_runs", run(owner, "queued"));
    const otherRun = await store.save("agent_runs", run(other, "queued"));
    const revoked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
        revoked.push(`${options?.method} ${String(input)}`);
        return new Response(null, { status: 204 });
      }),
    );

    await expect(deleteAccount(owner, "someone@example.test")).rejects.toThrow("Type your");
    const report = await deleteAccount(owner, owner.email.toUpperCase());
    expect(report.integrations).toEqual([{ provider: "github", revocation: "revoked" }]);
    expect(revoked).toEqual(["DELETE https://api.github.com/applications/fixture-client/grant"]);
    expect(report.artifacts).toBe(1);

    for (const table of ["records", "local_sessions"])
      expect(
        localDb().prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id=?`).get(owner.id),
      ).toEqual({ n: 0 });
    expect(
      localDb().prepare("SELECT id FROM local_users WHERE id=?").get(owner.id),
    ).toBeUndefined();
    expect(existsSync(path.join(dataDirectory(), "artifacts", owner.id))).toBe(false);
    expect(await getSecret(owner.id, ownerSecret)).toBeNull();
    const secretFiles = await readdir(path.join(dataDirectory(), "secrets"));
    expect(secretFiles).toEqual([`${otherSecret}.json`]);

    expect(sessions(other)).toBe(1);
    expect(await getSecret(other.id, otherSecret)).toBe("gho_other");
    expect(existsSync(path.join(dataDirectory(), "artifacts", otherKey))).toBe(true);
    expect((await store.get("agent_runs", otherRun.id, other.id))?.status).toBe("queued");
    // Repeating after completion (or a partial failure) is harmless.
    await expect(deleteAccount(owner, owner.email)).resolves.toBeTruthy();
  });

  it("refuses deletion while a paid subscription can still charge or a step is running", async () => {
    const owner = person("subscriber"),
      store = getStore();
    const subscription = await store.save("subscriptions", {
      ...entity(owner.id),
      plan: "pro",
      status: "past_due",
      customerId: "cus_x",
      subscriptionId: "sub_x",
      periodEnd: new Date(Date.now() + 86400000).toISOString(),
    });
    await expect(deleteAccount(owner, owner.email)).rejects.toThrow("Cancel your subscription");
    await store.save("subscriptions", { ...subscription, status: "canceled" });
    const active = await store.save(
      "agent_runs",
      run(owner, "running", new Date(Date.now() + 60000).toISOString()),
    );
    await expect(deleteAccount(owner, owner.email)).rejects.toThrow("application step is running");
    // An expired lease means no worker holds the run any longer.
    await store.save("agent_runs", {
      ...active,
      leaseUntil: new Date(Date.now() - 1).toISOString(),
    });
    await expect(deleteAccount(owner, owner.email)).resolves.toBeTruthy();
  });

  it("signs out every session of one account only", async () => {
    const owner = person("many-devices"),
      other = person("neighbor");
    addLocalUser(owner, ["d1", "d2", "d3"]);
    addLocalUser(other, ["n1"]);
    jar.set("jb_session", "d1");
    await signOutEverywhere(owner);
    expect(sessions(owner)).toBe(0);
    expect(sessions(other)).toBe(1);
    expect(jar.has("jb_session")).toBe(false);
  });
});

describe("operations", () => {
  it("reports worker readiness from heartbeats and hides details without the token", async () => {
    expect((await readiness()).checks.find((check) => check.name === "worker")?.status).toBe(
      "degraded",
    );
    await recordHeartbeat({
      workerId: "w1",
      startedAt: new Date().toISOString(),
      lanes: 2,
      busy: 1,
      version: null,
    });
    const healthy = await readiness();
    expect(healthy.status).toBe("ok");
    expect(await readiness(Date.now() + 120000)).toMatchObject({ status: "degraded" });

    process.env.HEALTH_CHECK_TOKEN = "probe-token";
    const anonymous = await (await ready(new Request("http://x/api/ready"))).json();
    expect(anonymous.checks[0]).toEqual({ name: "database", status: "ok" });
    const detailed = await (
      await ready(
        new Request("http://x/api/ready", { headers: { authorization: "Bearer probe-token" } }),
      )
    ).json();
    expect(detailed.checks[0].detail).toContain("local");
    delete process.env.HEALTH_CHECK_TOKEN;
  });

  it("flags configuration that must never be deployed", () => {
    expect(unsafeConfiguration({ NODE_ENV: "development", ENABLE_TEST_EMPLOYER: "true" })).toEqual(
      [],
    );
    expect(
      unsafeConfiguration({
        NODE_ENV: "production",
        APP_MODE: "local",
        ENABLE_TEST_EMPLOYER: "true",
        APP_URL: "http://example.test",
        STRIPE_SECRET_KEY: "sk_live_x",
        DEPLOYMENT_ENVIRONMENT: "staging",
      }),
    ).toHaveLength(4);
    expect(
      unsafeConfiguration({
        NODE_ENV: "production",
        APP_MODE: "supabase",
        APP_URL: "https://app.example.test",
      }),
    ).toEqual([]);
  });

  it("deletes only unreferenced artifacts older than the grace period", async () => {
    const owner = person("artifacts"),
      store = getStore();
    const referenced = await writeArtifact(
      owner.id,
      "kept.pdf",
      Buffer.from("1"),
      "application/pdf",
    );
    const orphan = await writeArtifact(owner.id, "lost.pdf", Buffer.from("2"), "application/pdf");
    const fresh = await writeArtifact(owner.id, "fresh.pdf", Buffer.from("3"), "application/pdf");
    await store.save("profile_sources", {
      ...entity(owner.id),
      kind: "document",
      name: "kept.pdf",
      storageKey: referenced,
    } as never);
    const old = new Date(Date.now() - 3 * 86400000);
    for (const key of [referenced, orphan])
      await utimes(path.join(dataDirectory(), "artifacts", key), old, old);
    const stale = new Date(Date.now() - 86400000).toISOString();
    addLocalUser(owner, []);
    localDb()
      .prepare("INSERT INTO local_sessions(token_hash,user_id,expires_at)VALUES(?,?,?)")
      .run("expired", owner.id, stale);
    const report = await runRetention();
    expect(report.orphanedArtifactsDeleted).toBe(1);
    expect(report.operational.sessions).toBe(1);
    const left = await readdir(path.join(dataDirectory(), "artifacts", owner.id));
    expect(left.map((name) => `${owner.id}/${name}`).sort()).toEqual([fresh, referenced].sort());
    await mkdir(path.join(dataDirectory(), "artifacts", "not a user id"), { recursive: true });
    await writeFile(path.join(dataDirectory(), "artifacts", "not a user id", "x"), "x");
    await expect(runRetention()).resolves.toMatchObject({ orphanedArtifactsDeleted: 0 });
  });

  it("signs, suppresses, and never throws on external alert delivery", async () => {
    expect(
      await sendOperationalAlert({
        severity: "info",
        event: "t",
        summary: "no url",
        dedupeKey: "a",
      }),
    ).toBe("logged_only");
    process.env.ALERT_WEBHOOK_URL = "https://alerts.example.test/hook";
    process.env.ALERT_WEBHOOK_SECRET = "alert-secret";
    const calls: { headers: Record<string, string>; body: string }[] = [];
    let status = 200;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, options?: RequestInit) => {
        calls.push({
          headers: options?.headers as Record<string, string>,
          body: String(options?.body),
        });
        return new Response(null, { status });
      }),
    );
    const alert = {
      severity: "critical" as const,
      event: "submission_unverified",
      summary: "check",
      details: { customer: "abc" },
      dedupeKey: "b",
    };
    expect(await sendOperationalAlert(alert)).toBe("delivered");
    const { headers, body } = calls[0];
    expect(headers["X-JB-Signature"]).toBe(
      `sha256=${createHmac("sha256", "alert-secret").update(`${headers["X-JB-Timestamp"]}.${body}`).digest("hex")}`,
    );
    expect(JSON.parse(body)).toMatchObject({
      event: "submission_unverified",
      details: { customer: "abc" },
    });
    expect(await sendOperationalAlert(alert)).toBe("suppressed");
    status = 503;
    expect(await sendOperationalAlert({ ...alert, dedupeKey: "c" }, { attempts: 2 })).toBe(
      "failed",
    );
    expect(calls).toHaveLength(3);
  });
});
