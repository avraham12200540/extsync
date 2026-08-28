import { test, expect } from "@playwright/test";
import { installAdminMockApi, defaultAdminConfig } from "./mock-admin-api";
import { loginAsAdmin, navigateViaNav } from "./admin-test-helpers";

test.describe("admin import runs", () => {
  test("renders recent runs with status, counts, and an error summary when present", async ({ page }) => {
    await installAdminMockApi(page, defaultAdminConfig());
    await loginAsAdmin(page);
    await navigateViaNav(page, "ייבוא", /\/guess\/admin\/imports$/);

    await expect(page.getByRole("heading", { name: "הרצות ייבוא" })).toBeVisible();
    // getByRole("cell", ...) rather than getByText - the same rows also render as a CSS-hidden
    // mobile card list, so a plain text query would match both and violate strict mode.
    await expect(page.getByRole("cell", { name: "הצליח", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "הצליח חלקית" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /no fixture topic detail/ })).toBeVisible();
  });

  test("triggering an import shows a confirmation, disables the button while in flight, and reports success without a duplicate submission", async ({ page }) => {
    const controller = await installAdminMockApi(page, defaultAdminConfig());
    await loginAsAdmin(page);
    // Client-side navigation, not page.goto() - see admin-moderation.spec.ts's equivalent note;
    // this test performs a real mutation (trigger) and needs the in-memory admin CSRF token alive.
    await navigateViaNav(page, "ייבוא", /\/guess\/admin\/imports$/);

    const requestCountBefore = controller.requestLog.filter((r) => r.pathname === "/admin/import-runs/trigger").length;

    await page.getByRole("button", { name: "הפעלת ייבוא" }).click();
    const confirmButton = page.getByRole("dialog").getByRole("button", { name: "אישור" });
    await confirmButton.click();

    // The confirm dialog closes on success, so the confirm control is gone by the time the request
    // has resolved - the real proof that a second submission never happened is the request count below,
    // not a post-hoc disabled check on an element the successful flow has already unmounted.
    await expect(page.getByRole("status").filter({ hasText: "הרצת הייבוא הופעלה" })).toBeVisible();
    const requestCountAfter = controller.requestLog.filter((r) => r.pathname === "/admin/import-runs/trigger").length;
    expect(requestCountAfter - requestCountBefore).toBe(1);
  });

  test("an already-running import disables the trigger button up front, and a race-lost 409 still surfaces the overlap message", async ({ page }) => {
    const runningConfig = defaultAdminConfig({
      importRuns: [
        {
          id: "run-running",
          status: "running",
          triggerKind: "admin",
          triggeredByAdminId: "admin-1",
          sourceEndpoint: "/api/recent",
          cursorUsed: null,
          postsFetched: 1,
          postsNew: 0,
          postsUpdated: 0,
          usersTouched: 0,
          rateLimitEvents: 0,
          errorSummary: null,
          startedAt: new Date().toISOString(),
          finishedAt: null,
        },
      ],
    });
    await installAdminMockApi(page, runningConfig);
    await loginAsAdmin(page);
    await page.goto("/guess/admin/imports");

    await expect(page.getByRole("button", { name: "ריצת ייבוא כבר פעילה" })).toBeDisabled();
  });

  test("the server rejecting a trigger as already-running shows the overlap error, not a silent success", async ({ page }) => {
    const controller = await installAdminMockApi(page, defaultAdminConfig());
    controller.setImportOverlap(true);
    await loginAsAdmin(page);
    await navigateViaNav(page, "ייבוא", /\/guess\/admin\/imports$/);

    await page.getByRole("button", { name: "הפעלת ייבוא" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "אישור" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "כבר רצה הרצת ייבוא" })).toBeVisible();
  });

  test("an empty run list shows a clear message", async ({ page }) => {
    await installAdminMockApi(page, defaultAdminConfig({ importRuns: [] }));
    await loginAsAdmin(page);
    await page.goto("/guess/admin/imports");
    await expect(page.getByText("אין עדיין הרצות ייבוא")).toBeVisible();
  });
});
