import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyProfile, entity, type AgentRun } from "../src/lib/contracts";
import { getStore, leaseSeconds } from "../src/lib/store";

const observed = vi.hoisted(() => ({
  leaseUntil: null as string | null,
  during: null as number | null,
}));
vi.mock("../src/lib/resume", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/resume")>()),
  // Inspect the persisted lease mid-run, after the stage renewal, then stop the run.
  generateResume: vi.fn(async (input: { userId: string }) => {
    const { getStore } = await import("../src/lib/store");
    const { oldestLeaseRenewal } = await import("../src/lib/agent");
    const run = (await getStore().list("agent_runs", input.userId))[0];
    observed.leaseUntil = run.leaseUntil;
    observed.during = oldestLeaseRenewal();
    throw new Error("stop after observing the lease");
  }),
}));
import { oldestLeaseRenewal, runOnce } from "../src/lib/agent";

beforeEach(() => {
  process.env.APP_MODE = "local";
  process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "career-lease-"));
});
afterEach(() => {
  delete process.env.WORKER_LEASE_SECONDS;
});

describe("queue leases", () => {
  it("bounds the configured lease like the SQL claim function", () => {
    process.env.WORKER_LEASE_SECONDS = "5";
    expect(leaseSeconds()).toBe(30);
    process.env.WORKER_LEASE_SECONDS = "5000";
    expect(leaseSeconds()).toBe(900);
    process.env.WORKER_LEASE_SECONDS = "not a number";
    expect(leaseSeconds()).toBe(600);
  });

  it("renews a stage lease with the configured length and tracks it for the watchdog", async () => {
    process.env.WORKER_LEASE_SECONDS = "45";
    const user = crypto.randomUUID(),
      store = getStore();
    const profile = emptyProfile("lease@example.test", "Lease Fixture");
    await store.save("candidate_profiles", { ...entity(user, user), profile, version: 1 });
    const run: AgentRun = {
      ...entity(user),
      applicationId: "",
      kind: "resume",
      status: "queued",
      stage: "selecting_resume",
      attempts: 0,
      maxAttempts: 1,
      leaseUntil: null,
      nextAttemptAt: new Date().toISOString(),
      error: null,
      approved: false,
      submitted: false,
    };
    await store.save("agent_runs", run);
    const before = Date.now();
    expect(await runOnce()).toBe(true);
    // A hard-coded 600 s renewal ignored configuration (and shortened leases above 600 s).
    const lease = Date.parse(observed.leaseUntil!) - before;
    expect(lease).toBeGreaterThan(44000);
    expect(lease).toBeLessThan(50000);
    expect(observed.during).toBeGreaterThanOrEqual(before);
    expect(oldestLeaseRenewal()).toBeNull();
  });
});
