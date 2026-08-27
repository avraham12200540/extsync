import { test, expect } from "@playwright/test";
import { installMockApi, defaultGameConfig } from "./mock-api";

test.describe("error and recovery states", () => {
  test("rate limited on daily start shows Hebrew copy, then recovers on retry", async ({ page }) => {
    const config = defaultGameConfig();
    const controller = await installMockApi(page, config);
    controller.failNext("/games/daily", 429, "rate_limited", 3);

    await page.goto("/guess");
    await page.getByRole("button", { name: "שחקו את אתגר היום" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "יותר מדי בקשות" })).toBeVisible();

    await page.getByText("שחקו את אתגר היום").click();
    await page.waitForURL(/\/guess\/game\//);
  });

  test("insufficient content on free play shows Hebrew copy", async ({ page }) => {
    const config = defaultGameConfig();
    const controller = await installMockApi(page, config);
    controller.failNext("/games/freeplay", 503, "insufficient_content");

    await page.goto("/guess");
    await page.getByRole("button", { name: "התחילו לשחק" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "אין כרגע מספיק תוכן" })).toBeVisible();
  });

  test("offline state surfaces Hebrew copy on the home page", async ({ page }) => {
    const config = defaultGameConfig();
    const controller = await installMockApi(page, config);
    controller.setOffline(true);

    await page.goto("/guess");
    await page.getByRole("button", { name: "התחילו לשחק" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "אין כרגע חיבור לרשת" })).toBeVisible();
  });

  test("expired session on the active game page shows recovery copy with a working retry", async ({ page }) => {
    const config = defaultGameConfig();
    const controller = await installMockApi(page, config);
    // Simulate a stale session surviving a reload: both the initial attempt and
    // apiFetch's single automatic re-bootstrap-and-retry come back unauthorized.
    controller.failNext("/results", 401, "session_expired");
    controller.failNext("/results", 401, "session_expired");

    await page.goto(`/guess/game/${config.gameId}`);
    await expect(page.getByRole("alert").filter({ hasText: "החיבור פג" })).toBeVisible();

    await page.getByRole("button", { name: "נסו שוב" }).click();
    const round1 = config.rounds[0]!;
    await expect(page.getByText(round1.posts[0]!)).toBeVisible();
  });

  test("unknown share token renders a not-found state, not a stack trace", async ({ page }) => {
    const config = defaultGameConfig();
    await installMockApi(page, config);

    await page.goto("/guess/results/does-not-exist");
    await expect(page.getByRole("heading", { name: "הדף לא נמצא" })).toBeVisible();
    const html = await page.content();
    expect(html).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
    expect(html.toLowerCase()).not.toContain("stack");
  });
});
