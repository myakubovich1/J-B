import { test, expect, type APIRequestContext } from "@playwright/test";
import { entity } from "../src/lib/contracts";
import { getStore } from "../src/lib/store";
import type { Workspace } from "../src/lib/workspace";

async function state(request: APIRequestContext): Promise<Workspace> {
  const response = await request.get("/api/workspace");
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<Workspace>;
}

test("paid standing authorization submits only within its saved scope and preserves the exact filled fields", async ({
  request,
}) => {
  const response = await request.post("/api/auth", {
    data: {
      action: "signup",
      name: "Autonomy Fixture",
      email: `autonomy-${crypto.randomUUID()}@example.test`,
      password: "Fixture-password-2026!",
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const initial = await state(request);
  const profile = {
    ...initial.profile,
    phone: "+1 212 555 0123",
    location: "New York, United States",
    skills: ["TypeScript", "React", "Python"],
    education: [
      {
        id: crypto.randomUUID(),
        school: "Fixture University",
        degree: "B.S.",
        major: "Computer Science",
        startDate: "2023",
        endDate: "2027",
      },
    ],
    eligibility: {
      country: "United States",
      workAuthorization: "yes" as const,
      sponsorship: "no" as const,
      confirmedAt: new Date().toISOString(),
    },
    autonomy: {
      enabled: true,
      allowedDomains: [new URL(process.env.APP_URL!).hostname],
      maxPerDay: 1,
      minScore: 80,
      approvedAt: new Date().toISOString(),
    },
  };
  // A disposable local entitlement fixture exercises backend enforcement. No billing bypass
  // route is exposed, and no real Stripe subscription is created by the test.
  const denied = await request.post("/api/workspace", {
    data: { action: "save_profile", profile },
  });
  expect(denied.status()).toBe(403);
  await getStore().save("subscriptions", {
    ...entity(initial.user.id),
    plan: "autonomous",
    status: "active",
    customerId: "cus_local_e2e",
    subscriptionId: "sub_local_e2e",
    periodEnd: new Date(Date.now() + 86400000).toISOString(),
  });
  const saved = await request.post("/api/workspace", { data: { action: "save_profile", profile } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  const queued = await request.post("/api/workspace", {
    data: { action: "apply", url: `${process.env.APP_URL}/fixture/employer/software-intern` },
  });
  expect(queued.status()).toBe(202);
  await expect
    .poll(async () => (await state(request)).applications[0]?.status, { timeout: 90000 })
    .toBe("submitted");
  const current = await state(request);
  const application = current.applications[0];
  expect(application.receipt?.confirmation).toContain("Confirmation receipt:");
  expect(application.preparedFields).toMatchObject({
    email: initial.user.email,
    first_name: "Autonomy",
    last_name: "Fixture",
    work_authorization: "yes",
    sponsorship: "no",
    resume: "resume.pdf",
  });
  expect(application.formSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
  expect(
    current.approvals.filter((approval) => approval.applicationId === application.id),
  ).toHaveLength(0);
  expect(current.billing.used).toBe(1);
  expect(current.billing.reserved).toBe(0);

  // Pause is a persisted user action. It remains disabled after the completed run.
  const paused = await request.post("/api/workspace", {
    data: {
      action: "save_profile",
      profile: { ...profile, autonomy: { ...profile.autonomy, enabled: false } },
    },
  });
  expect(paused.ok(), await paused.text()).toBeTruthy();
  expect((await state(request)).profile.autonomy.enabled).toBe(false);
});
