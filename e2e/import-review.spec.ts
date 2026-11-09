import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { Workspace } from "../src/lib/workspace";

test("structured import requires edited record review and explicit profile save", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.getByLabel("Your name", { exact: true }).fill("Import Fixture");
  await page
    .getByLabel("Email address", { exact: true })
    .fill(`import-${crypto.randomUUID()}@example.test`);
  await page.getByLabel(/^Password/).fill("Fixture-password-2026!");
  await page.getByRole("button", { name: "Create your workspace", exact: true }).click();
  await expect(page.locator(".app-shell[data-ready=true]")).toBeVisible();
  const state = async () => {
    const result = await page.request.get("/api/workspace");
    expect(result.ok()).toBeTruthy();
    return result.json() as Promise<Workspace>;
  };
  const upload = await page.request.post("/api/import", {
    multipart: {
      file: {
        name: "Education.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          "School Name,Degree Name,Field Of Study,Start Date,End Date\nFixture University,B.S.,Computer Science,2023,2027",
        ),
      },
    },
  });
  expect(upload.status()).toBe(202);
  const { source } = await upload.json();
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/profile");
        return (await response.json()).sources.find((item: { id: string }) => item.id === source.id)
          ?.status;
      },
      { timeout: 30000 },
    )
    .toBe("ready");
  expect((await state()).profile.education).toHaveLength(0);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Career Profile", exact: true })
    .click();
  await page.getByRole("button", { name: "Saved sources", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Saved sources" })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Review imported document" });
  await expect(
    dialog.getByRole("heading", { name: "Review the profile records", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Add reviewed records to profile draft", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Select education record 1", { exact: true }).check();
  await dialog.getByText("Review education fields", { exact: true }).click();
  await dialog
    .getByLabel("Major / field of study", { exact: true })
    .fill("Computer Science and Mathematics");
  await dialog.getByLabel(/^I reviewed the selected fields/).check();
  await mkdir(".data/qa", { recursive: true });
  await page.screenshot({ path: ".data/qa/import-review.png", fullPage: true });
  await dialog
    .getByRole("button", { name: "Add reviewed records to profile draft", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("profile draft");
  expect((await state()).profile.education).toHaveLength(0);
  await dialog.getByRole("button", { name: "Close import", exact: true }).click();
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect.poll(async () => (await state()).profile.education.length).toBe(1);
  const saved = (await state()).profile;
  expect(saved.education[0].major).toBe("Computer Science and Mathematics");
  expect(saved.claims.some((claim) => claim.source.includes(source.id) && claim.confirmed)).toBe(
    true,
  );
  const otherContext = await page.context().browser()!.newContext({ baseURL: process.env.APP_URL });
  try {
    expect(
      (
        await otherContext.request.post("/api/profile/suggestions", {
          data: { sourceId: source.id },
        })
      ).status(),
    ).toBe(401);
    const signup = await otherContext.request.post("/api/auth", {
      data: {
        action: "signup",
        name: "Other import fixture",
        email: `other-import-${crypto.randomUUID()}@example.test`,
        password: "Fixture-password-2026!",
      },
    });
    expect(signup.ok()).toBeTruthy();
    expect(
      (
        await otherContext.request.post("/api/profile/suggestions", {
          data: { sourceId: source.id },
        })
      ).status(),
    ).toBe(404);
  } finally {
    await otherContext.close();
  }
});
