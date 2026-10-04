/**
 * Playwright UI smoke for the Automation Control Dashboard.
 *
 * Prerequisites:
 *   - CoreServ on :4000 with ENABLE_TEST_HARNESS=1
 *   - Dashboard on :5000 (`npm run dashboard`)
 *   - Seeded lookup artifact present
 *
 * Run:
 *   npx playwright test tests/dashboard/ui.smoke.spec.ts
 */
import { test, expect } from "@playwright/test";

const DASH = process.env.DASHBOARD_URL ?? "http://localhost:5000";

test.describe("dashboard smoke", () => {
  test("home loads with demo mode", async ({ page }) => {
    await page.goto(DASH);
    await expect(page.getByText(/Demo mode/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Task library/i })).toBeVisible();
  });

  test("seeded replay Success shows $4,321.09", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(`${DASH}/run`);
    // Prefer seeded lookup artifact
    const select = page.getByLabel(/task|choose/i).first();
    if (await select.count()) {
      const options = await select.locator("option").allTextContents();
      const seeded = options.find((o) => /seeded|lookup/i.test(o));
      if (seeded) await select.selectOption({ label: seeded });
    } else {
      // card picker
      const card = page.getByText(/lookup.*savings|seeded/i).first();
      if (await card.count()) await card.click();
    }

    const member = page.getByLabel(/member/i).first();
    await member.fill("12345");
    await page.getByRole("button", { name: /^Run/i }).click();

    await expect(page.getByText(/\$4,321\.09|4321\.09/)).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByText(/Success/i).first()).toBeVisible();
  });

  test("not-found shows business outcome card", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(`${DASH}/run`);
    const select = page.getByLabel(/task|choose/i).first();
    if (await select.count()) {
      const options = await select.locator("option").allTextContents();
      const seeded = options.find((o) => /seeded|lookup/i.test(o));
      if (seeded) await select.selectOption({ label: seeded });
    }
    const member = page.getByLabel(/member/i).first();
    await member.fill("99999");
    await page.getByRole("button", { name: /^Run/i }).click();
    await expect(
      page.getByText(/No member found|business outcome|valid answer/i).first()
    ).toBeVisible({ timeout: 120_000 });
  });
});
