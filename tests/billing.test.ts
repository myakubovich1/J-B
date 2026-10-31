import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { entity } from "../src/lib/contracts";
import { getStore } from "../src/lib/store";
import { createCheckout, getPlanState, planLimits } from "../src/lib/billing";
import { hashPassword, verifyPassword } from "../src/lib/auth";
import { POST as stripeWebhook } from "../src/app/api/billing/webhook/route";
import { stripe } from "../src/lib/billing";

beforeEach(() => {
  process.env.APP_MODE = "local";
  process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "career-billing-"));
  delete process.env.PLAN_FREE_LIMIT;
});
describe("billing enforcement", () => {
  it("defaults to free and honors server-configured quotas", async () => {
    expect((await getPlanState("user-a")).plan).toBe("free");
    expect((await getPlanState("user-a")).limit).toBe(5);
    process.env.PLAN_FREE_LIMIT = "7";
    expect(planLimits().free).toBe(7);
  });
  it("only entitles active subscriptions within their paid period", async () => {
    const store = getStore();
    const sub = {
      ...entity("user-a"),
      plan: "autonomous" as const,
      status: "active",
      customerId: "cus_test",
      subscriptionId: "sub_test",
      periodEnd: new Date(Date.now() + 86400000).toISOString(),
    };
    await store.save("subscriptions", sub);
    expect((await getPlanState("user-a")).discovery).toBe(true);
    await store.save("subscriptions", { ...sub, status: "past_due" });
    expect((await getPlanState("user-a")).plan).toBe("free");
    await store.save("subscriptions", {
      ...sub,
      status: "active",
      periodEnd: new Date(Date.now() - 86400000).toISOString(),
    });
    expect((await getPlanState("user-a")).plan).toBe("free");
    expect((await getPlanState("user-b")).discovery).toBe(false);
  });
  it("stores salted password hashes and rejects wrong passwords", async () => {
    const first = await hashPassword("a-long-local-password");
    const second = await hashPassword("a-long-local-password");
    expect(first).not.toBe(second);
    expect(first).not.toContain("a-long-local-password");
    expect(await verifyPassword("a-long-local-password", first)).toBe(true);
    expect(await verifyPassword("wrong-password", first)).toBe(false);
  });
  it("routes an existing subscriber to the portal instead of creating a second subscription", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fixture_only";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_fixture_only";
    process.env.STRIPE_PRO_PRICE_ID = "price_fixture_pro";
    process.env.STRIPE_AUTONOMOUS_PRICE_ID = "price_fixture_auto";
    await getStore().save("subscriptions", {
      ...entity("existing"),
      plan: "pro",
      status: "active",
      customerId: "cus_fixture",
      subscriptionId: "sub_fixture",
      periodEnd: new Date(Date.now() + 86400000).toISOString(),
    });
    const portal = vi.spyOn(stripe().billingPortal.sessions, "create").mockResolvedValue({
      id: "bps_fixture",
      object: "billing_portal.session",
      url: "https://billing.stripe.com/fixture",
    } as never);
    try {
      expect(await createCheckout("existing", "fixture@example.test", "autonomous")).toBe(
        "https://billing.stripe.com/fixture",
      );
      expect(portal).toHaveBeenCalledTimes(1);
    } finally {
      portal.mockRestore();
    }
  });
  it("rejects tampered webhooks and processes a valid event idempotently", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fixture_only";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_fixture_only";
    const payload = JSON.stringify({
      id: "evt_fixture_only",
      object: "event",
      type: "checkout.session.completed",
      data: { object: { id: "cs_fixture_only", subscription: null } },
    });
    const signature = stripe().webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET,
    });
    const make = (body: string) =>
      new Request("http://127.0.0.1:3000/api/billing/webhook", {
        method: "POST",
        headers: { "stripe-signature": signature },
        body,
      });
    expect((await stripeWebhook(make(payload + " "))).status).toBe(400);
    expect((await stripeWebhook(make(payload))).status).toBe(200);
    const repeated = await stripeWebhook(make(payload));
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).duplicate).toBe(true);
  });
});
