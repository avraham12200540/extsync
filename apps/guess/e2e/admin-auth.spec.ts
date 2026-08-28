import { test, expect } from "@playwright/test";
import { installAdminMockApi, defaultAdminConfig, FIXTURE_ADMIN_EMAIL } from "./mock-admin-api";
import { loginAsAdmin } from "./admin-test-helpers";

test.describe("admin authentication and entry point", () => {
  test("visiting a protected admin page while unauthenticated redirects to login", async ({ page }) => {
    await installAdminMockApi(page, defaultAdminConfig());

    await page.goto("/guess/admin/moderation");
    await page.waitForURL(/\/guess\/admin\/login/);
    await expect(page.getByRole("heading", { name: "כניסת מנהלים" })).toBeVisible();
  });

  test("wrong credentials show an inline error and never authenticate", async ({ page }) => {
    await installAdminMockApi(page, defaultAdminConfig());

    await page.goto("/guess/admin/login");
    await page.getByLabel("אימייל").fill(FIXTURE_ADMIN_EMAIL);
    await page.getByLabel("סיסמה").fill("wrong-password");
    await page.getByRole("button", { name: "התחברות" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "אימייל או סיסמה שגויים" })).toBeVisible();
    expect(page.url()).toContain("/admin/login");
  });

  test("a real login reaches the protected overview and its quick links reach moderation and imports", async ({ page }) => {
    await installAdminMockApi(page, defaultAdminConfig());

    await loginAsAdmin(page);
    await expect(page.getByRole("heading", { name: "סקירה" })).toBeVisible();

    // Scoped to the quick-links <ul> specifically - the sidebar nav rail has a link with the
    // same label, and both are visible on this page simultaneously.
    const quickLinks = page.getByRole("list").getByRole("link");
    await quickLinks.filter({ hasText: "מודרציה" }).click();
    await page.waitForURL(/\/guess\/admin\/moderation$/);
    await expect(page.getByRole("heading", { name: "תור מודרציה" })).toBeVisible();

    await page.getByRole("navigation").getByRole("link", { name: "סקירה", exact: true }).click();
    await page.waitForURL(/\/guess\/admin$/);
    await quickLinks.filter({ hasText: "ייבוא" }).click();
    await page.waitForURL(/\/guess\/admin\/imports$/);
    await expect(page.getByRole("heading", { name: "הרצות ייבוא" })).toBeVisible();
  });

  test("no admin session token, CSRF token, or credential ever lands in localStorage/sessionStorage/a readable cookie", async ({ page }) => {
    await installAdminMockApi(page, defaultAdminConfig());
    await loginAsAdmin(page);

    const storageDump = await page.evaluate(() => ({
      localStorage: JSON.stringify(localStorage),
      sessionStorage: JSON.stringify(sessionStorage),
      cookie: document.cookie,
    }));
    expect(storageDump.localStorage).not.toMatch(/csrf/i);
    expect(storageDump.localStorage).not.toMatch(/battery-staple/);
    expect(storageDump.sessionStorage).toBe("{}");
    expect(storageDump.cookie).not.toMatch(/session/i);
  });
});
