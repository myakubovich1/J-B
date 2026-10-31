import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Application, Approval, AgentRun, Records, Collection } from "../src/lib/contracts";
import { emptyProfile, entity } from "../src/lib/contracts";

const memory = vi.hoisted(() => new Map<string, unknown>());
const billing = vi.hoisted(() => ({
  plan: "free" as const,
  limit: 5,
  used: 0,
  reserved: 0,
  discovery: false,
  subscription: null,
}));
vi.mock("../src/lib/store", () => ({
  getStore: () => ({
    get: async (table: string, id: string, userId: string) =>
      memory.get(`${table}:${userId}:${id}`) || null,
    list: async (table: string, userId: string) =>
      [...memory.entries()]
        .filter(([key]) => key.startsWith(`${table}:${userId}:`))
        .map(([, value]) => value),
    save: async (table: string, row: { id: string; userId: string }) => {
      memory.set(`${table}:${row.userId}:${row.id}`, row);
      return row;
    },
    createIfAbsent: async (table: string, row: { id: string; userId: string }) => {
      const key = `${table}:${row.userId}:${row.id}`;
      if (!memory.has(key)) memory.set(key, row);
      return memory.get(key);
    },
    claimRun: async () => null,
    reserveSubmission: async () => true,
    releaseSubmission: async () => {},
    recordVerifiedSubmission: async () => {},
  }),
}));
vi.mock("../src/lib/billing", () => ({ getPlanState: async () => billing }));
vi.mock("../src/lib/resume", () => ({ generateResume: vi.fn() }));
vi.mock("../src/lib/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/browser")>()),
  executeApplication: vi.fn(),
}));
import { applicationFieldAnswer, eligibilityContext } from "../src/lib/browser";
import {
  assertTransition,
  enqueueApplication,
  resolveApproval,
  stableHash,
} from "../src/lib/agent";
const save = <K extends Collection>(table: K, row: Records[K]) =>
  memory.set(`${table}:${row.userId}:${row.id}`, row);

beforeEach(() => {
  memory.clear();
  billing.used = 0;
  billing.reserved = 0;
  process.env.APP_MODE = "local";
  process.env.ENABLE_TEST_EMPLOYER = "true";
  process.env.APP_URL = "http://127.0.0.1:3000";
  delete process.env.GLOBAL_EMERGENCY_STOP;
});

describe("agent state and authorization", () => {
  it("allows real application progress but blocks fabricated backwards transitions", () => {
    expect(() => assertTransition("ready", "applying")).not.toThrow();
    expect(() => assertTransition("applying", "submitted")).not.toThrow();
    expect(() => assertTransition("submitted", "applying")).toThrow();
    expect(() => assertTransition("discovered", "submitted")).toThrow();
  });
  it("hashes review snapshots consistently independent of key order", () =>
    expect(stableHash({ a: 1, b: { c: 2, d: 3 } })).toBe(stableHash({ b: { d: 3, c: 2 }, a: 1 })));
  it("deduplicates equivalent URLs within a tenant while separating tenants", async () => {
    const first = await enqueueApplication(
      "user-1",
      "http://127.0.0.1:3000/fixture/employer/software-intern?utm_source=test",
    );
    const again = await enqueueApplication(
      "user-1",
      "http://127.0.0.1:3000/fixture/employer/software-intern",
    );
    const other = await enqueueApplication(
      "user-2",
      "http://127.0.0.1:3000/fixture/employer/software-intern",
    );
    expect(again.id).toBe(first.id);
    expect(other.id).not.toBe(first.id);
    expect([...memory.keys()].filter((key) => key.startsWith("applications:user-1:"))).toHaveLength(
      1,
    );
    expect([...memory.keys()].filter((key) => key.startsWith("agent_runs:user-1:"))).toHaveLength(
      1,
    );
  });
  it("enforces allowance before enqueue", async () => {
    billing.used = 5;
    await expect(
      enqueueApplication("user-1", "http://127.0.0.1:3000/fixture/employer/software-intern"),
    ).rejects.toMatchObject({ code: "quota_exceeded" });
  });
  it("denies access to another tenant's approval", async () => {
    const approval: Approval = {
      ...entity("other", "approval"),
      applicationId: "app",
      runId: "run",
      kind: "submission",
      status: "pending",
      title: "Submit?",
      description: "Review",
      questions: [],
      response: {},
      resolvedAt: null,
    };
    save("approval_requests", approval);
    await expect(resolveApproval("user-1", "approval", "approve")).rejects.toMatchObject({
      code: "approval_not_found",
    });
  });
  it("refuses another action once submission has started", async () => {
    const app = await enqueueApplication(
      "user-1",
      "http://127.0.0.1:3000/fixture/employer/software-intern",
    );
    const approval: Approval = {
      ...entity("user-1", "approval"),
      applicationId: app.id,
      runId: app.runId,
      kind: "submission",
      status: "pending",
      title: "Submit?",
      description: "Review",
      questions: [],
      response: {},
      resolvedAt: null,
    };
    save("approval_requests", approval);
    save("applications", {
      ...app,
      status: "ready",
      approvalId: approval.id,
      submissionStartedAt: new Date().toISOString(),
    });
    const run = memory.get(`agent_runs:user-1:${app.runId}`) as AgentRun;
    save("agent_runs", { ...run, status: "waiting" });
    await expect(resolveApproval("user-1", approval.id, "approve")).rejects.toMatchObject({
      code: "submission_started",
    });
  });
  it("invalidates stale application approvals when the reviewed profile changed", async () => {
    const app = await enqueueApplication(
      "user-1",
      "http://127.0.0.1:3000/fixture/employer/software-intern",
    );
    const profile = emptyProfile("person@example.com", "Person");
    save("candidate_profiles", { ...entity("user-1", "profile"), profile, version: 1 });
    const approval: Approval = {
      ...entity("user-1", "approval"),
      applicationId: app.id,
      runId: app.runId,
      kind: "submission",
      status: "pending",
      title: "Submit?",
      description: "Review",
      questions: [],
      response: {},
      resolvedAt: null,
      snapshotHash: "obsolete",
    };
    save("approval_requests", approval);
    save("applications", { ...app, status: "ready", approvalId: approval.id });
    const run = memory.get(`agent_runs:user-1:${app.runId}`) as AgentRun;
    save("agent_runs", { ...run, status: "waiting" });
    await resolveApproval("user-1", approval.id, "approve");
    expect((memory.get("approval_requests:user-1:approval") as Approval).status).toBe("denied");
    expect((memory.get(`agent_runs:user-1:${app.runId}`) as AgentRun).approved).toBe(false);
  });
  it("persists confirmed question meaning and eligibility context without granting submission approval", async () => {
    const app = await enqueueApplication(
      "user-1",
      "http://127.0.0.1:3000/fixture/employer/software-intern",
    );
    const profile = emptyProfile("person@example.test", "Person");
    save("candidate_profiles", { ...entity("user-1", "profile"), profile, version: 1 });
    const approval: Approval = {
      ...entity("user-1", "approval"),
      applicationId: app.id,
      runId: app.runId,
      kind: "question",
      status: "pending",
      title: "Confirm work eligibility",
      description: "Review",
      questions: [
        {
          key: "work_authorization",
          label: "Are you legally authorized for this role?",
          options: ["yes", "no"],
        },
        { key: "sponsorship", label: "Will you require sponsorship?", options: ["yes", "no"] },
      ],
      response: {},
      resolvedAt: null,
    };
    save("approval_requests", approval);
    save("applications", { ...app, status: "needs_input", approvalId: approval.id });
    const run = memory.get(`agent_runs:user-1:${app.runId}`) as AgentRun;
    save("agent_runs", { ...run, status: "waiting" });
    await resolveApproval("user-1", approval.id, "approve", {
      work_authorization: "yes",
      sponsorship: "no",
    });
    const updated = memory.get(`applications:user-1:${app.id}`) as Application;
    expect(applicationFieldAnswer(updated, "work_authorization", approval.questions[0])).toBe(
      "yes",
    );
    expect(
      applicationFieldAnswer(updated, "work_authorization", {
        label: "Are you authorized in Canada?",
        options: ["yes", "no"],
      }),
    ).toBeUndefined();
    expect(updated.eligibilityContext).toBe(eligibilityContext(profile));
    expect((memory.get(`agent_runs:user-1:${app.runId}`) as AgentRun).approved).toBe(false);
  });
});
