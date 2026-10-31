import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
test("core screens retain labeled controls, contrast, and responsive boundaries", async ({
  page,
}) => {
  const violations: unknown[] = [];
  const inspect = async (screen: string) => {
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    violations.push(
      ...result.violations.map((v) => ({
        screen,
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
    );
  };
  await page.goto("/");
  await inspect("Sign up");
  await page.request.post("/api/auth", {
    data: {
      action: "signup",
      email: `a11y-${crypto.randomUUID()}@example.test`,
      name: "Accessible Fixture",
      password: "Fixture-password-2026!",
    },
  });
  await page.reload();
  await expect(page.locator(".app-shell[data-ready=true]")).toBeVisible();
  for (const view of ["Agent", "Career Profile", "Resumes"]) {
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: view, exact: true })
      .click();
    await inspect(view);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle navigation", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Agent", exact: true })
    .click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await expect(page.locator(".sidebar")).toHaveAttribute("inert", "");
  expect(violations).toEqual([]);
});
