import { test, expect } from "@playwright/test";
import type { Workspace } from "../src/lib/workspace";
test("authentication, tenant artifacts, premium boundaries, and queued source review", async ({
  request,
  playwright,
}) => {
  const anonymous = await playwright.request.newContext({
    baseURL: process.env.APP_URL || "http://127.0.0.1:3000",
  });
  expect((await anonymous.get("/api/workspace")).status()).toBe(401);
  expect((await anonymous.get(`/api/artifacts/${crypto.randomUUID()}`)).status()).toBe(401);
  const signup = await request.post("/api/auth", {
    data: {
      action: "signup",
      email: `safety-${crypto.randomUUID()}@example.test`,
      name: "Safety Fixture",
      password: "Fixture-password-2026!",
    },
  });
  expect(signup.ok()).toBe(true);
  const snapshot = (await (await request.get("/api/workspace")).json()) as Workspace;
  const profile = {
    ...snapshot.profile,
    legalName: "Safety Fixture",
    education: [
      {
        id: crypto.randomUUID(),
        school: "Fixture University",
        degree: "BS",
        major: "CS",
        startDate: "2023",
        endDate: "2027",
      },
    ],
  };
  expect(
    (await request.post("/api/workspace", { data: { action: "save_profile", profile } })).ok(),
  ).toBe(true);
  const escalated = {
    ...profile,
    autonomy: {
      enabled: true,
      allowedDomains: ["jobs.lever.co"],
      maxPerDay: 1,
      minScore: 90,
      approvedAt: new Date().toISOString(),
    },
  };
  expect(
    (
      await request.post("/api/workspace", { data: { action: "save_profile", profile: escalated } })
    ).status(),
  ).toBe(403);
  const blocked = await request.post("/api/workspace", {
    data: { action: "apply", url: "https://127.0.0.1/private" },
  });
  expect(blocked.status()).toBe(400);
  const crossOrigin = await request.post("/api/workspace", {
    headers: { Origin: "https://untrusted.example" },
    data: { action: "save_profile", profile },
  });
  expect(crossOrigin.status()).toBe(403);
  const upload = await request.post("/api/import", {
    multipart: {
      file: {
        name: "career-notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          "Built a TypeScript scheduling application for a student club. Source for review only.",
        ),
      },
    },
  });
  expect(upload.status()).toBe(202);
  const { source } = await upload.json();
  await expect
    .poll(
      async () => {
        const response = await request.get("/api/profile");
        const result = await response.json();
        return result.sources.find((s: { id: string }) => s.id === source.id)?.status;
      },
      { timeout: 30000 },
    )
    .toBe("ready");
  const afterImport = (await (await request.get("/api/workspace")).json()) as Workspace;
  expect(afterImport.profile.claims.some((c) => c.text.includes("student club"))).toBe(false);
  const badTemplate = await request.post("/api/import", {
    multipart: {
      kind: "template",
      file: {
        name: "bad.tex",
        mimeType: "application/x-tex",
        buffer: Buffer.from("\\input{/etc/passwd}"),
      },
    },
  });
  expect(badTemplate.status()).toBe(400);
  expect(
    (
      await request.post("/api/workspace", {
        data: { action: "generate_resume", templateId: "jakes", track: "software" },
      })
    ).status(),
  ).toBe(202);
  await expect
    .poll(
      async () => {
        const response = await request.get("/api/workspace");
        const result = (await response.json()) as Workspace;
        return result.resumes[0]?.validation.valid;
      },
      { timeout: 60000 },
    )
    .toBe(true);
  const ownState = (await (await request.get("/api/workspace")).json()) as Workspace,
    resumeId = ownState.resumes[0].id;
  const other = await playwright.request.newContext({
    baseURL: process.env.APP_URL || "http://127.0.0.1:3000",
  });
  await other.post("/api/auth", {
    data: {
      action: "signup",
      email: `other-${crypto.randomUUID()}@example.test`,
      name: "Other Fixture",
      password: "Fixture-password-2026!",
    },
  });
  expect((await other.get(`/api/artifacts/${resumeId}`)).status()).toBe(404);
  expect((await other.get("/api/admin")).status()).toBe(403);
  expect((await request.get(`/api/artifacts/${resumeId}`)).status()).toBe(200);
  await anonymous.dispose();
  await other.dispose();
});
