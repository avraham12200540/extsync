import { test } from "@playwright/test";
import path from "node:path";
import { installAdminMockApi, defaultAdminConfig } from "./mock-admin-api";
import { loginAsAdmin, navigateViaNav } from "./admin-test-helpers";

const VIEWPORTS = [
  { name: "375x812", width: 375, height: 812 },
  { name: "1440x900", width: 1440, height: 900 },
];

const OUT_DIR = path.join(__dirname, "..", "test-results", "screenshots");

test.describe.configure({ mode: "serial" });

for (const viewport of VIEWPORTS) {
  test(`capture admin screens at ${viewport.name}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await installAdminMockApi(page, defaultAdminConfig());

    await page.goto("/guess/admin/login");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: path.join(OUT_DIR, `admin-${viewport.name}-01-login.png`), fullPage: true });

    await loginAsAdmin(page);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: path.join(OUT_DIR, `admin-${viewport.name}-02-overview.png`), fullPage: true });

    await navigateViaNav(page, "מודרציה", /\/guess\/admin\/moderation$/);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: path.join(OUT_DIR, `admin-${viewport.name}-03-moderation-queue.png`), fullPage: true });

    await page.locator('a[href="/guess/admin/moderation/post-1"]:visible').first().click();
    await page.waitForURL(/\/guess\/admin\/moderation\/post-1$/);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: path.join(OUT_DIR, `admin-${viewport.name}-04-moderation-detail.png`), fullPage: true });

    await page.getByRole("button", { name: "עריכה" }).click();
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: path.join(OUT_DIR, `admin-${viewport.name}-05-moderation-edit.png`), fullPage: true });

    await navigateViaNav(page, "ייבוא", /\/guess\/admin\/imports$/);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: path.join(OUT_DIR, `admin-${viewport.name}-06-imports.png`), fullPage: true });
  });
}

test("capture admin light mode at 1440x900", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await installAdminMockApi(page, defaultAdminConfig());

  await loginAsAdmin(page);
  await page.getByRole("button", { name: "מצב בהיר" }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(OUT_DIR, "admin-1440x900-light-01-overview.png"), fullPage: true });

  await navigateViaNav(page, "מודרציה", /\/guess\/admin\/moderation$/);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(OUT_DIR, "admin-1440x900-light-02-moderation-queue.png"), fullPage: true });

  await page.locator('a[href="/guess/admin/moderation/post-1"]:visible').first().click();
  await page.waitForURL(/\/guess\/admin\/moderation\/post-1$/);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(OUT_DIR, "admin-1440x900-light-03-moderation-detail.png"), fullPage: true });
});
