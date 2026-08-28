import type { Page } from "@playwright/test";
import { FIXTURE_ADMIN_EMAIL, FIXTURE_ADMIN_PASSWORD } from "./mock-admin-api";

/** Logs in through the real login form (never bypasses it) and waits for the redirect to the overview page. */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/guess/admin/login");
  await page.getByLabel("אימייל").fill(FIXTURE_ADMIN_EMAIL);
  await page.getByLabel("סיסמה").fill(FIXTURE_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "התחברות" }).click();
  await page.waitForURL(/\/guess\/admin$/);
}

/**
 * Client-side (SPA) navigation via the sidebar nav rail, scoped to the `<nav>` landmark to avoid
 * matching the overview page's own "quick links" list (same label, different section).
 * Deliberately NOT page.goto() - a full navigation reloads the document and drops the in-memory
 * admin CSRF token (see admin-client.ts's module doc), which is real, intended app behavior but
 * would make every subsequent mutating test action open the reauth prompt instead of exercising
 * the flow under test. Only the very first navigation to /admin/login should ever use goto().
 */
export async function navigateViaNav(page: Page, label: string, urlPattern: RegExp): Promise<void> {
  // Below the md breakpoint the sidebar rail is CSS-hidden and the same nav only exists inside a
  // collapsible header menu (admin-shell.tsx) - open it first if its toggle is visible.
  const menuToggle = page.getByRole("button", { name: "תפריט" });
  if (await menuToggle.isVisible()) await menuToggle.click();

  await page.getByRole("navigation").getByRole("link", { name: label, exact: true }).click();
  await page.waitForURL(urlPattern);
}
