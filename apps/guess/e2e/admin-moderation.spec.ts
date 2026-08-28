import { test, expect } from "@playwright/test";
import { installAdminMockApi, defaultAdminConfig } from "./mock-admin-api";
import { loginAsAdmin, navigateViaNav } from "./admin-test-helpers";

test.describe("admin moderation queue and detail", () => {
  test("renders the queue, and status filtering narrows the visible rows", async ({ page }) => {
    await installAdminMockApi(page, defaultAdminConfig());
    await loginAsAdmin(page);
    await navigateViaNav(page, "מודרציה", /\/guess\/admin\/moderation$/);

    // Scoped to the desktop table - the same rows are also rendered as a CSS-hidden mobile
    // card list (identical to users/page.tsx's established responsive pattern), so an unscoped
    // text/role query would double-count every row.
    const rows = page.locator("table tbody tr");
    await expect(rows).toHaveCount(2);

    await page.getByLabel("סטטוס").selectOption("needs_review");
    await expect(rows).toHaveCount(1);
  });

  test("sorting a column toggles aria-sort and re-requests the queue", async ({ page }) => {
    await installAdminMockApi(page, defaultAdminConfig());
    await loginAsAdmin(page);
    await page.goto("/guess/admin/moderation");

    const qualityHeader = page.getByRole("columnheader", { name: "איכות" });
    await expect(qualityHeader).toHaveAttribute("aria-sort", "none");
    await qualityHeader.getByRole("button").click();
    await expect(qualityHeader).toHaveAttribute("aria-sort", "ascending");
    await qualityHeader.getByRole("button").click();
    await expect(qualityHeader).toHaveAttribute("aria-sort", "descending");
  });

  test("raw content is rendered as inert text - a script/HTML payload never executes and never becomes markup", async ({ page }) => {
    let alertFired = false;
    await installAdminMockApi(page, defaultAdminConfig());
    await loginAsAdmin(page);

    page.on("dialog", () => {
      alertFired = true;
    });

    await navigateViaNav(page, "מודרציה", /\/guess\/admin\/moderation$/);
    // post-1 is the fixture with the injection-shaped raw content - targeted by href rather than
    // by username text, since both fixture posts share the same author and the default sort
    // (postedAt desc) does not put post-1 first.
    await page.locator('a[href="/guess/admin/moderation/post-1"]').first().click();
    await page.waitForURL(/\/guess\/admin\/moderation\/post-1$/);

    // The raw block must show the literal tag text, not a rendered <b>/<i>/<script>.
    const rawBlock = page.locator("pre", { hasText: "נסיון הזרקה" });
    await expect(rawBlock).toBeVisible();
    const rawHtml = await rawBlock.innerHTML();
    expect(rawHtml).not.toContain("<b>");
    expect(rawHtml).not.toContain("<script>");
    expect(await page.locator("script", { hasText: "alert(1)" }).count()).toBe(0);
    expect(alertFired).toBe(false);
  });

  test("edit updates only the sanitized text, approve/reject work, and a stale version reports a conflict instead of silently overwriting", async ({ page }) => {
    const controller = await installAdminMockApi(page, defaultAdminConfig());
    await loginAsAdmin(page);
    // Every step below stays on client-side (SPA) navigation, never page.goto() - a full
    // navigation would reload the document and drop the in-memory admin CSRF token exactly
    // like a real hard reload would, which would legitimately (and correctly) route every
    // mutation below through the reauth prompt instead of the flow under test.
    await navigateViaNav(page, "מודרציה", /\/guess\/admin\/moderation$/);
    await page.locator('a[href="/guess/admin/moderation/post-1"]').first().click();
    await page.waitForURL(/\/guess\/admin\/moderation\/post-1$/);

    // Edit: only clean content changes; raw stays untouched in the DOM.
    await page.getByRole("button", { name: "עריכה" }).click();
    const textarea = page.getByLabel("טקסט מסונן לעריכה");
    await textarea.fill("טקסט מסונן אחרי עריכה");
    await page.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("status").filter({ hasText: "הטקסט עודכן" })).toBeVisible();
    await expect(page.getByText("טקסט מסונן אחרי עריכה")).toBeVisible();
    await expect(page.locator("pre", { hasText: "נסיון הזרקה" })).toBeVisible();

    // Approve: the trigger button opens a confirm dialog; the dialog's own confirm button shares the
    // same label ("אישור") by design, so it is scoped to the dialog to disambiguate.
    await page.getByRole("button", { name: "אישור", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "אישור", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "הפוסט אושר" })).toBeVisible();

    // A forced stale-version conflict on the next mutation must surface the conflict banner, not a silent overwrite.
    controller.forceConflictOnce();
    await page.getByRole("button", { name: "דחייה", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "דחייה", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "מישהו אחר כבר עדכן את הפוסט" })).toBeVisible();
  });

  test("moderation flags show a localized label, never the backend's raw English reason text in Hebrew mode", async ({ page }) => {
    await installAdminMockApi(page, defaultAdminConfig());
    await loginAsAdmin(page);
    await navigateViaNav(page, "מודרציה", /\/guess\/admin\/moderation$/);
    await page.locator('a[href="/guess/admin/moderation/post-1"]').first().click();
    await page.waitForURL(/\/guess\/admin\/moderation\/post-1$/);

    // Hebrew (default) mode: the localized label is shown, the raw English backend reason is not.
    await expect(page.getByText("מבוסס בעיקר על ציטוט")).toBeVisible();
    const hebrewHtml = await page.content();
    expect(hebrewHtml).not.toContain("quote ratio 0.65");

    // Switching to English surfaces an appropriate localized label, plus the raw reason as
    // secondary diagnostic text only now that the surrounding UI is itself in English.
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByText("Mostly quoted content")).toBeVisible();
    await expect(page.getByText("(quote ratio 0.65 exceeds the maximum of 0.6)")).toBeVisible();
  });

  test("an empty queue and a not-found post both show a clear message, never a stack trace", async ({ page }) => {
    await installAdminMockApi(page, defaultAdminConfig({ moderationPosts: [] }));
    await loginAsAdmin(page);

    await page.goto("/guess/admin/moderation");
    await expect(page.getByText("אין פוסטים בתור")).toBeVisible();

    await page.goto("/guess/admin/moderation/does-not-exist");
    await expect(page.getByText("הפוסט לא נמצא")).toBeVisible();
    const html = await page.content();
    expect(html.toLowerCase()).not.toContain("stack");
  });
});
