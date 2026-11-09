import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const password = "Fixture-password-2026!";
test("customer can export data, end every session, and delete the account", async ({
  page,
  browser,
  playwright,
}) => {
  const baseURL = process.env.APP_URL || "http://127.0.0.1:3000";
  const email = `account-${crypto.randomUUID()}@example.test`;
  const neighbor = await playwright.request.newContext({ baseURL });
  const neighborEmail = `neighbor-${crypto.randomUUID()}@example.test`;
  expect(
    (
      await neighbor.post("/api/auth", {
        data: { action: "signup", email: neighborEmail, name: "Neighbor", password },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post("/api/auth", {
        data: { action: "signup", email, name: "Account Fixture", password },
      })
    ).ok(),
  ).toBe(true);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Your data and account." })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download my data" }).click();
  const exported = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(exported.format).toBe("jb-account-export");
  expect(exported.account.email).toBe(email);
  expect(JSON.stringify(exported)).not.toContain(neighborEmail);

  // A second device signed in to the same account loses its session too.
  const device = await browser.newContext({ baseURL });
  expect(
    (await device.request.post("/api/auth", { data: { action: "signin", email, password } })).ok(),
  ).toBe(true);
  expect((await device.request.get("/api/workspace")).status()).toBe(200);
  await page.getByRole("button", { name: "Sign out of all devices" }).click();
  await page.waitForURL(`${baseURL}/`);
  expect((await device.request.get("/api/workspace")).status()).toBe(401);
  expect((await page.request.get("/api/workspace")).status()).toBe(401);
  await device.close();

  expect(
    (await page.request.post("/api/auth", { data: { action: "signin", email, password } })).ok(),
  ).toBe(true);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete account" }).click();
  const confirm = page.getByRole("button", { name: "Permanently delete my account" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(`Type ${email} to confirm`).fill(email);
  await confirm.click();
  await page.waitForURL(`${baseURL}/`);
  expect((await page.request.get("/api/workspace")).status()).toBe(401);
  const signin = await page.request.post("/api/auth", {
    data: { action: "signin", email, password },
  });
  expect(signin.status()).toBe(400);
  expect((await neighbor.get("/api/workspace")).status()).toBe(200);
  await neighbor.dispose();
});

test("health and readiness endpoints answer without authentication", async ({ playwright }) => {
  const anonymous = await playwright.request.newContext({
    baseURL: process.env.APP_URL || "http://127.0.0.1:3000",
  });
  const live = await anonymous.get("/api/health");
  expect(live.status()).toBe(200);
  expect(await live.json()).toEqual({ status: "ok" });
  const ready = await anonymous.get("/api/ready");
  expect(ready.status()).toBe(200);
  const body = await ready.json();
  expect(body.checks.map((check: { name: string }) => check.name)).toEqual([
    "database",
    "configuration",
    "worker",
    "emergency_stop",
  ]);
  expect(body.checks[0]).not.toHaveProperty("detail");
  await anonymous.dispose();
});
