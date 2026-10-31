import { beforeEach, describe, expect, it } from "vitest";
import {
  aggregateAdmin,
  AdminAccessError,
  getAdminSnapshot,
  isAdmin,
  requireAdmin,
  type AdminData,
} from "../src/lib/admin";
import {
  entity,
  type AgentRun,
  type UsageEvent,
  type Subscription,
  type User,
} from "../src/lib/contracts";
const admin: User = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.test",
  name: "Operator",
};
beforeEach(() => {
  process.env.ADMIN_USER_IDS = admin.id;
});
describe("operator authorization", () => {
  it("uses an explicit exact user-ID allowlist", () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin({ ...admin, id: admin.id + "-suffix" })).toBe(false);
    expect(isAdmin(null)).toBe(false);
    process.env.ADMIN_USER_IDS = "";
    expect(isAdmin(admin)).toBe(false);
  });
  it("denies unauthorized access before querying any store", async () => {
    expect(() => requireAdmin(null)).toThrow(AdminAccessError);
    await expect(
      getAdminSnapshot({
        ...admin,
        id: "22222222-2222-4222-8222-222222222222",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
describe("operational aggregation", () => {
  it("separates attempts, retries, verified usage, current entitlements, and recorded costs", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    const at = "2026-10-15T12:00:00Z";
    const base = { ...entity(admin.id), createdAt: at, updatedAt: at };
    const usage = (kind: UsageEvent["kind"], quantity: number, costUsd = 0): UsageEvent => ({
      ...base,
      id: crypto.randomUUID(),
      kind,
      quantity,
      costUsd,
      applicationId: "app-1",
    });
    const sub = (plan: Subscription["plan"], status: string): Subscription => ({
      ...base,
      id: crypto.randomUUID(),
      plan,
      status,
      customerId: "private-customer",
      subscriptionId: "private-subscription",
      periodEnd: "2026-11-01T00:00:00Z",
    });
    const run: AgentRun = {
      ...base,
      applicationId: "app-1",
      kind: "application",
      status: "completed",
      stage: "completed",
      attempts: 2,
      maxAttempts: 3,
      leaseUntil: null,
      nextAttemptAt: at,
      error: null,
      approved: true,
      submitted: true,
      startedAt: at,
      finishedAt: "2026-10-15T12:01:30Z",
    };
    const data: AdminData = {
      userCount: 4,
      profiles: [],
      applications: [],
      runs: [run, { ...run, id: crypto.randomUUID(), status: "queued" }],
      subscriptions: [
        sub("pro", "active"),
        sub("autonomous", "trialing"),
        sub("autonomous", "canceled"),
      ],
      usage: [
        usage("attempt", 1),
        usage("retry", 1),
        usage("verified_submission", 1),
        usage("browser", 2, 0.4),
        { ...usage("model", 1, 0.1), inputTokens: 1000, outputTokens: 100 },
      ],
    };
    const result = aggregateAdmin(data, {
      now,
      proMonthlyUsd: 39,
      autonomousMonthlyUsd: 199,
      modelPricingConfigured: false,
      browserPricingConfigured: true,
      emergencyStop: true,
    });
    expect(result.paidSubscribers).toBe(1);
    expect(result.trialSubscribers).toBe(1);
    expect(result.nominalMrrUsd).toBe(39);
    expect(result.attempts).toBe(1);
    expect(result.retries).toBe(1);
    expect(result.verifiedSubmissions).toBe(1);
    expect(result.browserMinutes).toBe(2);
    expect(result.recordedCostUsd).toBeCloseTo(0.5);
    expect(result.averageRuntimeSeconds).toBe(90);
    expect(result.costEstimateComplete).toBe(false);
    expect(result.queueDepth).toBe(1);
    expect(result.emergencyStop).toBe(true);
    expect(result.customers[0].customer).not.toContain(admin.id);
    expect(JSON.stringify(result)).not.toContain("private-customer");
    expect(JSON.stringify(result)).not.toContain(admin.email);
  });
});
