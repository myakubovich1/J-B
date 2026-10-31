import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalStore } from "../src/lib/store";
import { entity, type AgentRun, type Application } from "../src/lib/contracts";
import { readArtifact, writeArtifact } from "../src/lib/storage";

const store = new LocalStore();
function application(userId = "user-a"): Application {
  return {
    ...entity(userId),
    jobUrl: `https://example.com/jobs/${crypto.randomUUID()}`,
    job: null,
    status: "evaluating",
    runId: crypto.randomUUID(),
    resumeId: null,
    matchScore: null,
    matchReasons: [],
    answers: {},
    receipt: null,
    error: null,
    submittedAt: null,
    submissionStartedAt: null,
    approvalId: null,
  };
}
function queuedRun(app: Application): AgentRun {
  return {
    ...entity(app.userId),
    applicationId: app.id,
    kind: "application",
    status: "queued",
    stage: "reading_job",
    attempts: 0,
    maxAttempts: 3,
    leaseUntil: null,
    nextAttemptAt: new Date().toISOString(),
    error: null,
    approved: false,
    submitted: false,
  };
}
beforeEach(() => {
  process.env.APP_MODE = "local";
  process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "career-store-"));
  process.env.WORKER_CONCURRENCY = "2";
});
describe("tenant persistence", () => {
  it("creates records atomically without resetting an already running job", async () => {
    const app = await store.createIfAbsent("applications", application());
    const run = queuedRun(app);
    await store.createIfAbsent("agent_runs", run);
    await store.claimRun();
    const duplicate = await store.createIfAbsent("agent_runs", {
      ...run,
      status: "queued",
      attempts: 0,
    });
    expect(duplicate.status).toBe("running");
    expect(duplicate.attempts).toBe(1);
    await expect(store.createIfAbsent("agent_runs", { ...run, userId: "user-b" })).rejects.toThrow(
      "ownership",
    );
  });
  it("serializes runs per user while permitting different users", async () => {
    const first = await store.save("applications", application());
    const second = await store.save("applications", application());
    const other = await store.save("applications", application("user-b"));
    for (const app of [first, second, other]) await store.save("agent_runs", queuedRun(app));
    const claims = await Promise.all([store.claimRun(), store.claimRun(), store.claimRun()]);
    expect(claims.filter(Boolean)).toHaveLength(2);
    expect(
      claims
        .filter(Boolean)
        .map((x) => x!.userId)
        .sort(),
    ).toEqual(["user-a", "user-b"]);
  });
  it("marks a crashed final attempt uncertain after the submission latch", async () => {
    const app = await store.save("applications", {
      ...application(),
      submissionStartedAt: new Date().toISOString(),
    });
    const run = {
      ...queuedRun(app),
      status: "running" as const,
      attempts: 3,
      leaseUntil: new Date(Date.now() - 10000).toISOString(),
    };
    await store.save("agent_runs", run);
    expect(await store.claimRun()).toBeNull();
    expect((await store.get("applications", app.id, app.userId))?.status).toBe(
      "submission_unverified",
    );
    expect((await store.get("agent_runs", run.id, app.userId))?.status).toBe("waiting");
  });
  it("prevents reads, overwrites, and deletes by another owner", async () => {
    const app = await store.save("applications", application());
    expect(await store.get("applications", app.id, "user-b")).toBeNull();
    expect(await store.list("applications", "user-b")).toEqual([]);
    await expect(store.save("applications", { ...app, userId: "user-b" })).rejects.toThrow(
      "another user",
    );
    await store.remove("applications", app.id, "user-b");
    expect((await store.get("applications", app.id, "user-a"))?.jobUrl).toBe(app.jobUrl);
  });
  it("rejects duplicate applications per user", async () => {
    const app = await store.save("applications", application());
    await expect(store.save("applications", { ...app, id: crypto.randomUUID() })).rejects.toThrow();
  });
  it("claims a queued run once and increments its persisted attempt", async () => {
    const app = await store.save("applications", application());
    const run: AgentRun = {
      ...entity(app.userId),
      applicationId: app.id,
      kind: "application",
      status: "queued",
      stage: "reading_job",
      attempts: 0,
      maxAttempts: 3,
      leaseUntil: null,
      nextAttemptAt: new Date().toISOString(),
      error: null,
      approved: false,
      submitted: false,
    };
    await store.save("agent_runs", run);
    const claims = await Promise.all([store.claimRun("one"), store.claimRun("two")]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)?.attempts).toBe(1);
    expect((await store.get("agent_runs", run.id, app.userId))?.status).toBe("running");
  });
  it("reserves quota atomically and records only evidenced submissions once", async () => {
    const apps = await Promise.all(
      Array.from({ length: 5 }, () => store.save("applications", application())),
    );
    const reserved = await Promise.all(
      apps.map((app) => store.reserveSubmission(app.userId, app.id, 2)),
    );
    expect(reserved.filter(Boolean)).toHaveLength(2);
    expect(await store.reserveSubmission(apps[0].userId, apps[0].id, 2)).toBe(true);
    await expect(store.recordVerifiedSubmission(apps[0].userId, apps[0].id)).rejects.toThrow(
      "receipt",
    );
    const app = {
      ...apps[0],
      status: "submitted" as const,
      receipt: {
        confirmation: "TEST-123",
        url: "https://example.com/receipt/123",
        verifiedAt: new Date().toISOString(),
      },
    };
    await store.save("applications", app);
    await store.recordVerifiedSubmission(app.userId, app.id);
    await store.recordVerifiedSubmission(app.userId, app.id);
    const usage = await store.list("usage_events", app.userId);
    expect(usage.filter((x) => x.kind === "verified_submission")).toHaveLength(1);
    expect(usage.filter((x) => x.kind === "reservation")).toHaveLength(1);
  });
  it("releases safe failures but retains ambiguous submission reservations", async () => {
    const app = await store.save("applications", application());
    await store.reserveSubmission(app.userId, app.id, 1);
    await store.releaseSubmission(app.userId, app.id);
    expect(await store.list("usage_events", app.userId)).toHaveLength(0);
    await store.reserveSubmission(app.userId, app.id, 1);
    await store.save("applications", {
      ...app,
      submissionStartedAt: new Date().toISOString(),
    });
    await store.releaseSubmission(app.userId, app.id);
    expect(await store.list("usage_events", app.userId)).toHaveLength(1);
  });
  it("isolates storage paths and rejects traversal", async () => {
    const key = await writeArtifact(
      "user-a",
      "resume.pdf",
      Buffer.from("%PDF-test"),
      "application/pdf",
    );
    expect((await readArtifact("user-a", key)).toString()).toBe("%PDF-test");
    await expect(readArtifact("user-b", key)).rejects.toThrow("denied");
    await expect(readArtifact("user-a", "user-a/../../career.db")).rejects.toThrow("denied");
  });
});
