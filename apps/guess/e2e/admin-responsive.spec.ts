import { test, expect } from "@playwright/test";
import { installAdminMockApi, defaultAdminConfig } from "./mock-admin-api";
import { loginAsAdmin, navigateViaNav } from "./admin-test-helpers";

const VIEWPORTS = [
  { name: "320x568-mobile", width: 320, height: 568 },
  { name: "430x932-mobile", width: 430, height: 932 },
  { name: "768x1024-tablet", width: 768, height: 1024 },
];

async function overflowPx(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

for (const viewport of VIEWPORTS) {
  test(`admin pages have no horizontal overflow and keep controls reachable at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await installAdminMockApi(page, defaultAdminConfig());
    await loginAsAdmin(page);
    expect(await overflowPx(page), `overview has horizontal overflow at ${viewport.name}`).toBeLessThanOrEqual(0);

    await navigateViaNav(page, "מודרציה", /\/guess\/admin\/moderation$/);
    expect(await overflowPx(page), `moderation queue has horizontal overflow at ${viewport.name}`).toBeLessThanOrEqual(0);
    // The filter control must stay reachable, not just present in the DOM.
    await expect(page.getByLabel("סטטוס")).toBeInViewport();

    await page.locator('a[href="/guess/admin/moderation/post-1"]:visible').first().click();
    await page.waitForURL(/\/guess\/admin\/moderation\/post-1$/);
    expect(await overflowPx(page), `moderation detail has horizontal overflow at ${viewport.name}`).toBeLessThanOrEqual(0);

    // Raw/clean comparison must wrap safely (no internal horizontal scrollbar), not just avoid
    // pushing the whole document wider - checked on the raw <pre> block specifically, since it is
    // the one element carrying long, bidi-heavy, injection-shaped content least likely to wrap cleanly.
    const rawBlock = page.locator("pre", { hasText: "נסיון הזרקה" });
    await expect(rawBlock).toBeVisible();
    const rawOverflow = await rawBlock.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(rawOverflow, `raw content block overflows its own box at ${viewport.name}`).toBeLessThanOrEqual(0);

    // A confirm dialog's action buttons must stay visible/reachable within the viewport, not
    // pushed off-screen by a narrow width.
    await page.getByRole("button", { name: "אישור", exact: true }).click();
    const dialogConfirm = page.getByRole("dialog").getByRole("button", { name: "אישור", exact: true });
    const dialogCancel = page.getByRole("dialog").getByRole("button", { name: "ביטול" });
    await expect(dialogConfirm).toBeInViewport();
    await expect(dialogCancel).toBeInViewport();
    await dialogCancel.click();

    await navigateViaNav(page, "ייבוא", /\/guess\/admin\/imports$/);
    expect(await overflowPx(page), `imports page has horizontal overflow at ${viewport.name}`).toBeLessThanOrEqual(0);
    await expect(page.getByRole("button", { name: "הפעלת ייבוא" })).toBeInViewport();
  });
}

test("moderation detail and user detail content stay centered under the sidebar at desktop width", async ({ page }) => {
  // Regression test: these two detail pages once used `max-w-*xl` without `mx-auto`, which in this
  // RTL app pins the block to its inline-start edge (the right, next to the sidebar) instead of
  // centering it, leaving a large dead void on the left at desktop widths - every other narrow-content
  // admin page (e.g. the overview) already used `mx-auto`. Asserts the fix generically (roughly equal
  // gaps on both sides of <main>'s content) so this can't regress the same way again.
  await page.setViewportSize({ width: 1440, height: 900 });
  await installAdminMockApi(page, defaultAdminConfig());
  await loginAsAdmin(page);

  async function assertCentered(label: string) {
    const main = page.locator("main");
    const container = main.locator("> div").first();
    const mainBox = await main.boundingBox();
    const containerBox = await container.boundingBox();
    if (!mainBox || !containerBox) throw new Error(`could not measure ${label}`);
    const leftGap = containerBox.x - mainBox.x;
    const rightGap = mainBox.x + mainBox.width - (containerBox.x + containerBox.width);
    expect(
      Math.abs(leftGap - rightGap),
      `${label}: left gap ${leftGap}px vs right gap ${rightGap}px - content should be centered under <main>, not pinned to one edge`,
    ).toBeLessThanOrEqual(4);
  }

  await navigateViaNav(page, "מודרציה", /\/guess\/admin\/moderation$/);
  await page.locator('a[href="/guess/admin/moderation/post-1"]:visible').first().click();
  await page.waitForURL(/\/guess\/admin\/moderation\/post-1$/);
  await assertCentered("moderation detail");

  // Direct navigation, not a list-page click-through: the mock API here has no
  // GET /admin/forum-users (list) handler, only the :id detail one this needs.
  await page.goto("/guess/admin/users/user-1");
  await page.waitForURL(/\/guess\/admin\/users\/user-1$/);
  await assertCentered("user detail");
});

test("admin pages respect prefers-reduced-motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installAdminMockApi(page, defaultAdminConfig());
  await loginAsAdmin(page);
  await navigateViaNav(page, "מודרציה", /\/guess\/admin\/moderation$/);

  // Every interactive element in the admin UI uses Tailwind's transition-colors/transition-opacity
  // (hover/disabled state), never an entrance animation - globals.css's reduced-motion media query
  // forces transition-duration to ~0 globally, checked here directly against a real rendered control.
  const statusFilter = page.getByLabel("סטטוס");
  const duration = await statusFilter.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration) * 1000);
  expect(duration, "transition duration should be ~0 under prefers-reduced-motion").toBeLessThanOrEqual(1);
});
