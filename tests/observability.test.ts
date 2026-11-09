import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { entity, type Application, type AuditAction, type UsageEvent } from "../src/lib/contracts";
import { getStore } from "../src/lib/store";
import {
  evaluateCostAlerts,
  pricingComplete,
  readCostAlert,
  recordResumeGeneration,
} from "../src/lib/observability";

const now = new Date("2026-11-04T12:00:00Z");
const directories: string[] = [];
function application(userId = "user-a"): Application {
  return {
    ...entity(userId),
    jobUrl: `https://example.test/jobs/${crypto.randomUUID()}`,
    job: null,
    status: "ready",
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
async function usage(app: Application, costUsd: number, overrides: Partial<UsageEvent> = {}) {
  return getStore().save("usage_events", {
    ...entity(app.userId),
    kind: "browser",
    applicationId: app.id,
    quantity: 1,
    costUsd,
    createdAt: "2026-11-01T12:00:00Z",
    ...overrides,
  });
}
beforeEach(() => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "jb-observability-"));
  directories.push(directory);
  vi.stubEnv("APP_MODE", "local");
  vi.stubEnv("DATA_DIR", directory);
  vi.stubEnv("MODEL_INPUT_USD_PER_MILLION", "1");
  vi.stubEnv("MODEL_OUTPUT_USD_PER_MILLION", "2");
  vi.stubEnv("BROWSER_USD_PER_MINUTE", "0.1");
  vi.stubEnv("PER_USER_MONTHLY_BUDGET_USD", "100");
  vi.stubEnv("MONTHLY_BUDGET_ALERT_RATIO", "0.5");
  vi.stubEnv("EXPENSIVE_APPLICATION_ALERT_USD", "20");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() =>
  directories.forEach((directory) => rmSync(directory, { recursive: true, force: true })),
);

describe("durable execution signals", () => {
  it("records one application and monthly budget alert under repeated concurrent evaluations", async () => {
    const app = await getStore().save("applications", application());
    await usage(app, 38);
    await usage(app, 12, { kind: "model" });
    await Promise.all(
      Array.from({ length: 4 }, () => evaluateCostAlerts(app.userId, app.id, { now })),
    );
    const actions = await getStore().list("agent_actions", app.userId);
    expect(actions).toHaveLength(2);
    expect(actions.map((action) => readCostAlert(action)?.kind).sort()).toEqual([
      "expensive_application",
      "monthly_budget",
    ]);
    expect(actions.every((action) => readCostAlert(action)?.recordedCostUsd === 50)).toBe(true);
    expect(await getStore().list("notifications", app.userId)).toHaveLength(2);
    expect(await getStore().list("notifications", "another-user")).toEqual([]);
  });
  it("flags missing unit prices on real activity without claiming unpriced work is free", async () => {
    const app = await getStore().save("applications", application());
    vi.stubEnv("MODEL_INPUT_USD_PER_MILLION", "");
    expect(pricingComplete([])).toBe(true);
    await usage(app, 0, { kind: "model" });
    await evaluateCostAlerts(app.userId, app.id, { now });
    await evaluateCostAlerts(app.userId, app.id, { now });
    const actions = await getStore().list("agent_actions", app.userId);
    expect(actions).toHaveLength(1);
    expect(readCostAlert(actions[0])).toMatchObject({
      kind: "pricing_incomplete",
      recordedCostUsd: 0,
      thresholdUsd: null,
      estimateComplete: false,
    });
    expect((await getStore().list("notifications", app.userId))[0].body).toContain("unit prices");
  });
  it("separates lifetime application costs from the UTC monthly budget and excludes future or invalid costs", async () => {
    const app = await getStore().save("applications", application());
    await usage(app, 100, { createdAt: "2026-10-01T00:00:00Z" });
    await usage(app, 2);
    await usage(app, 1000, { createdAt: "2026-11-05T00:00:00Z" });
    await usage(app, -1000);
    await usage(app, Number.NaN);
    const other = await getStore().save("applications", application("other-user"));
    await usage(other, 1000);
    await evaluateCostAlerts(app.userId, app.id, { now });
    const actions = await getStore().list("agent_actions", app.userId);
    expect(actions).toHaveLength(1);
    expect(readCostAlert(actions[0])).toMatchObject({
      kind: "expensive_application",
      recordedCostUsd: 102,
    });
    expect(await getStore().list("agent_actions", "other-user")).toEqual([]);
  });
  it("heals a missing notification and preserves the original observation and read state", async () => {
    const app = await getStore().save("applications", application());
    await usage(app, 21);
    await evaluateCostAlerts(app.userId, app.id, { now });
    const notification = (await getStore().list("notifications", app.userId))[0];
    await getStore().remove("notifications", notification.id, app.userId);
    await usage(app, 1);
    await evaluateCostAlerts(app.userId, null, { now });
    const healed = (await getStore().list("notifications", app.userId))[0];
    expect(healed.id).toBe(notification.id);
    expect(healed.body).toContain("$21.00");
    expect(healed.body).not.toContain("$22.00");
    await getStore().save("notifications", { ...healed, read: true });
    await evaluateCostAlerts(app.userId, app.id, { now });
    expect(await getStore().list("notifications", app.userId)).toHaveLength(1);
    expect((await getStore().list("notifications", app.userId))[0].read).toBe(true);
  });
  it("rejects cross-owner application context and uses safe defaults for malformed settings", async () => {
    const app = await getStore().save("applications", application());
    const other = await getStore().save("applications", application("other-user"));
    await usage(app, 6);
    vi.stubEnv("EXPENSIVE_APPLICATION_ALERT_USD", "NaN");
    vi.stubEnv("MONTHLY_BUDGET_ALERT_RATIO", "-1");
    await evaluateCostAlerts(app.userId, other.id, { now });
    expect(await getStore().list("agent_actions", app.userId)).toEqual([]);
    await evaluateCostAlerts(app.userId, app.id, { now });
    expect(readCostAlert((await getStore().list("agent_actions", app.userId))[0])).toMatchObject({
      kind: "expensive_application",
      thresholdUsd: 5,
    });
  });
  it("can disable the per-application threshold without disabling monthly budget signals", async () => {
    const app = await getStore().save("applications", application());
    await usage(app, 70);
    vi.stubEnv("EXPENSIVE_APPLICATION_ALERT_USD", "0");
    await evaluateCostAlerts(app.userId, app.id, { now });
    const actions = await getStore().list("agent_actions", app.userId);
    expect(actions).toHaveLength(1);
    expect(readCostAlert(actions[0])?.kind).toBe("monthly_budget");
  });
  it("records failed and successful generation attempts once per tenant without private content", async () => {
    await recordResumeGeneration("user-a", "same-attempt", { succeeded: false });
    await recordResumeGeneration("user-a", "same-attempt", { succeeded: true });
    await recordResumeGeneration("user-a", "new-attempt", { succeeded: true });
    await recordResumeGeneration("user-b", "same-attempt", { succeeded: true });
    const actions = await getStore().list("agent_actions", "user-a");
    expect(actions).toHaveLength(2);
    expect(actions.map((action) => action.details.outcome).sort()).toEqual(["failed", "succeeded"]);
    expect(await getStore().list("agent_actions", "user-b")).toHaveLength(1);
    const other = await getStore().save("applications", application("user-b"));
    await expect(
      recordResumeGeneration("user-a", "wrong-owner", {
        succeeded: false,
        applicationId: other.id,
      }),
    ).rejects.toThrow("unavailable");
    expect(JSON.stringify(actions)).not.toContain("same-attempt");
  });
  it("strictly projects alert fields and rejects malformed audit records", () => {
    const action: AuditAction = {
      ...entity("user-a"),
      action: "execution_cost_alert",
      applicationId: null,
      details: {
        kind: "monthly_budget",
        recordedCostUsd: 80,
        thresholdUsd: 80,
        estimateComplete: true,
        token: "must-not-leak",
      },
    };
    expect(JSON.stringify(readCostAlert(action))).not.toContain("must-not-leak");
    expect(readCostAlert({ ...action, details: { ...action.details, kind: "email" } })).toBeNull();
    expect(
      readCostAlert({ ...action, details: { ...action.details, kind: ["monthly_budget"] } }),
    ).toBeNull();
    expect(
      readCostAlert({ ...action, details: { ...action.details, thresholdUsd: null } }),
    ).toBeNull();
    expect(
      readCostAlert({ ...action, details: { ...action.details, recordedCostUsd: Number.NaN } }),
    ).toBeNull();
  });
});
