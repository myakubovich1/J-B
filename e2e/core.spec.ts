import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import type { Workspace } from "../src/lib/workspace";
import { mkdir } from "node:fs/promises";

async function workspace(request: APIRequestContext): Promise<Workspace> {
  const response = await request.get("/api/workspace");
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<Workspace>;
}
async function register(page: Page, suffix: string) {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("On autopilot.");
  await page.getByRole("link", { name: "Get started", exact: true }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await page.getByLabel("Your name", { exact: true }).fill("Alex Fixture");
  await page.getByLabel("Email address", { exact: true }).fill(`career-${suffix}@example.test`);
  await page.getByLabel(/^Password/).fill("Fixture-password-2026!");
  await page.getByRole("button", { name: "Create your workspace", exact: true }).click();
  await expect(page.locator(".app-shell[data-ready=true]")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
}

test("onboarding → selected LaTeX template → approved browser submission → verified tracking", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await register(page, crypto.randomUUID());
  await mkdir(".data/qa", { recursive: true });
  // Confirm hydration through a real event before screenshot APIs modify caret styles.
  await page.getByRole("button", { name: "View notifications", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your updates", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close notifications", exact: true }).click();
  await page.screenshot({
    path: ".data/qa/agent-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".data/qa/agent-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "Career Profile", exact: true }).click();
  await page.getByLabel("Legal name", { exact: true }).fill("Alex Fixture");
  await page.getByLabel("Phone", { exact: true }).fill("+1 212 555 0100");
  await page.getByLabel("Location", { exact: true }).fill("New York, United States");
  await page
    .getByLabel("Professional headline", { exact: true })
    .fill("Computer science student building reliable web applications.");
  await page.getByRole("tab", { name: /Education & experience/ }).click();
  await page.getByRole("button", { name: "Add education", exact: true }).click();
  await page.getByLabel("School or university", { exact: true }).fill("Fixture University");
  await page.getByLabel("Degree", { exact: true }).fill("B.S.");
  await page.getByLabel("Major / field", { exact: true }).fill("Computer Science");
  await page.getByLabel("Start date", { exact: true }).fill("2023");
  await page.getByLabel("Graduation / expected date", { exact: true }).fill("2027");
  await page.getByRole("tab", { name: /Projects & strengths/ }).click();
  await page
    .getByLabel("Skills (comma separated)", { exact: true })
    .fill("TypeScript, Python, React");
  await page.getByRole("tab", { name: /Your preferences/ }).click();
  await page.getByLabel("Country these answers apply to", { exact: true }).fill("United States");
  await page
    .getByLabel("Are you currently authorized to work in this country?", { exact: true })
    .selectOption("yes");
  await page
    .getByLabel("Will you require employer sponsorship?", { exact: true })
    .selectOption("no");
  await page.getByLabel("I confirm these answers for the country above.", { exact: true }).check();
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect.poll(async () => (await workspace(page.request)).profileVersion).toBe(1);
  await nav.getByRole("button", { name: "Resumes", exact: true }).click();
  const technical = page
    .locator(".template-card")
    .filter({ has: page.getByText("Technical minimal", { exact: true }) });
  await technical.getByRole("button", { name: "Set default", exact: true }).click();
  await expect
    .poll(async () => (await workspace(page.request)).profile.defaultTemplate)
    .toBe("technical");
  const jakes = page
    .locator(".template-card")
    .filter({ has: page.getByText("Jake's Resume", { exact: true }) });
  await jakes.getByRole("button", { name: "Set default", exact: true }).click();
  await expect
    .poll(async () => (await workspace(page.request)).profile.defaultTemplate)
    .toBe("jakes");
  await jakes.getByRole("button", { name: "Layout settings", exact: true }).click();
  const layout = page.getByRole("dialog", { name: "Jake's Resume layout", exact: true });
  await layout.getByLabel("Page margins", { exact: true }).selectOption("0.75");
  await layout.getByLabel("Paper size", { exact: true }).selectOption("a4");
  await layout.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(layout.getByRole("status")).toContainText("Layout saved");
  await layout.getByRole("button", { name: "Close template settings", exact: true }).click();
  await jakes.getByRole("button", { name: "Generate", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await workspace(page.request)).resumes.some(
          (r) => r.templateId === "jakes" && r.validation.valid,
        ),
      { timeout: 60000 },
    )
    .toBeTruthy();
  await page.getByRole("button", { name: "Preview", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "Resume preview" })).toBeVisible();
  await expect(page.getByTitle("Generated resume PDF")).toHaveAttribute(
    "src",
    /\/api\/artifacts\//,
  );
  await page.getByRole("button", { name: "Close preview", exact: true }).click();
  await nav.getByRole("button", { name: "Agent", exact: true }).click();
  await page.getByRole("button", { name: /Try the local test employer/ }).click();
  await expect
    .poll(
      async () =>
        (await workspace(page.request)).approvals.some(
          (a) => a.kind === "submission" && a.status === "pending",
        ),
      { timeout: 70000 },
    )
    .toBeTruthy();
  let state = await workspace(page.request);
  const application = state.applications[0];
  expect(application.status).toBe("ready");
  expect(application.receipt).toBeNull();
  expect(state.billing.used).toBe(0);
  const resume = state.resumes.find((r) => r.id === application.resumeId)!;
  expect(resume.templateId).toBe("jakes");
  expect(resume.templateSettings).toMatchObject({ marginInches: 0.75, paper: "a4" });
  expect(resume.validation.valid).toBe(true);
  expect(resume.content.name).toBe("Alex Fixture");
  await page.getByRole("button", { name: "Approve & submit", exact: true }).click();
  await expect
    .poll(async () => (await workspace(page.request)).applications[0].status, { timeout: 60000 })
    .toBe("submitted");
  state = await workspace(page.request);
  const submitted = state.applications[0];
  expect(submitted.receipt?.confirmation).toContain("Confirmation receipt:");
  expect(submitted.receipt?.url).toMatch(/\/fixture\/confirmation\/[a-f0-9-]+$/);
  expect(submitted.submittedAt).toBeTruthy();
  expect(submitted.preparedFields?.email).toBe(state.profile.email);
  expect(submitted.preparedFields?.resume).toBe("resume.pdf");
  expect(submitted.formSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
  expect(state.billing.used).toBe(1);
  const receipt = await page.request.get(submitted.receipt!.url);
  expect(receipt.ok()).toBeTruthy();
  expect(await receipt.text()).toContain('data-testid="confirmation"');
  const pdf = await page.request.get(`/api/artifacts/${resume.id}`);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await nav.getByRole("button", { name: "Applications", exact: true }).click();
  await expect(page.getByRole("table")).toContainText("Northstar Labs (test employer)");
  await expect(page.getByRole("table")).toContainText("Submitted");
  await page.screenshot({ path: ".data/qa/applications-desktop.png", fullPage: true });
  // Sending the same posting again must preserve a single receipt and a single billed submission.
  const duplicate = await page.request.post("/api/workspace", {
    data: { action: "apply", url: submitted.jobUrl },
  });
  expect(duplicate.ok()).toBeTruthy();
  const afterDuplicate = await workspace(page.request);
  expect(afterDuplicate.applications).toHaveLength(1);
  expect(afterDuplicate.billing.used).toBe(1);
  expect(afterDuplicate.applications[0].receipt?.url).toBe(submitted.receipt?.url);
  await page
    .getByRole("navigation", { name: "Account navigation" })
    .getByRole("button", { name: "Settings & Billing", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("link", { name: "Get started", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/signin");
  await expect(page.getByRole("button", { name: "Sign in", exact: true }).last()).toBeVisible();
});
