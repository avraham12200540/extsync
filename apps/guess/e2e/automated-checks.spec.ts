import { test, expect } from "@playwright/test";
import { installMockApi, defaultGameConfig } from "./mock-api";

test.describe("automated UI safety checks", () => {
  test("no horizontal overflow at the narrowest supported viewport (320px)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const config = defaultGameConfig({ gameId: "game-overflow-check" });
    await installMockApi(page, config);

    await page.goto("/guess");
    let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "home page has horizontal overflow at 320px").toBeLessThanOrEqual(0);

    await page.getByRole("button", { name: "שחקו את אתגר היום" }).click();
    await page.waitForURL(/\/guess\/game\//);
    await page.getByRole("button", { name: "עוד פוסט" }).click();
    overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "active round has horizontal overflow at 320px - long/mixed usernames must wrap or truncate, not overflow").toBeLessThanOrEqual(0);
  });

  test("keyboard focus is visible on interactive elements", async ({ page }) => {
    const config = defaultGameConfig({ gameId: "game-focus-check" });
    await installMockApi(page, config);
    await page.goto("/guess");

    const startButton = page.getByRole("button", { name: "שחקו את אתגר היום" });
    await startButton.focus();
    const outline = await startButton.evaluate((el) => {
      const style = getComputedStyle(el);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    expect(outline.outlineStyle, "focused button has no visible outline").not.toBe("none");
    expect(outline.outlineWidth).not.toBe("0px");
  });

  test("prefers-reduced-motion disables animation duration", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const config = defaultGameConfig({ gameId: "game-motion-check" });
    await installMockApi(page, config);
    await page.goto("/guess");

    const durations = await page.evaluate(() => {
      const animated = document.querySelector('[class*="animate-fade"]');
      if (!animated) return null;
      const style = getComputedStyle(animated);
      return { animationDuration: style.animationDuration, transitionDuration: style.transitionDuration };
    });
    if (durations) {
      const ms = parseFloat(durations.animationDuration) * 1000;
      expect(ms, "animation duration should be ~0 under prefers-reduced-motion").toBeLessThanOrEqual(1);
    }
  });

  test("no session/CSRF token or answer data ever lands in localStorage, sessionStorage, or a readable cookie", async ({ page }) => {
    const config = defaultGameConfig({ gameId: "game-storage-check" });
    await installMockApi(page, config);
    await page.goto("/guess");
    await page.getByRole("button", { name: "שחקו את אתגר היום" }).click();
    await page.waitForURL(/\/guess\/game\//);

    const round1 = config.rounds[0]!;
    const wrongChoice = round1.choices.find((c) => c.choiceId !== round1.correctChoiceId)!;
    await page.getByRole("button", { name: new RegExp(wrongChoice.username) }).click();

    const storageDump = await page.evaluate(() => ({
      localStorage: JSON.stringify(localStorage),
      sessionStorage: JSON.stringify(sessionStorage),
      cookie: document.cookie,
    }));

    // Only UI preferences (locale/theme) are expected in localStorage - never a CSRF token, session id, or the round's correctChoiceId.
    expect(storageDump.localStorage).not.toMatch(/csrf/i);
    expect(storageDump.localStorage).not.toContain(round1.correctChoiceId);
    expect(storageDump.sessionStorage).toBe("{}");
    // The session cookie is HttpOnly by design - document.cookie must not be able to read it.
    expect(storageDump.cookie).not.toMatch(/session/i);

    const url = page.url();
    expect(url).not.toMatch(/csrf/i);
    expect(url).not.toContain(round1.correctChoiceId);
  });

  test("no correctness indicator appears in the DOM before a round resolves", async ({ page }) => {
    const config = defaultGameConfig({ gameId: "game-preresolve-check" });
    await installMockApi(page, config);
    await page.goto("/guess");
    await page.getByRole("button", { name: "שחקו את אתגר היום" }).click();
    await page.waitForURL(/\/guess\/game\//);

    const round1 = config.rounds[0]!;
    const html = await page.content();
    expect(html).not.toContain(round1.correctChoiceId);
    for (const choice of round1.choices) {
      const button = page.getByRole("button", { name: new RegExp(choice.username) });
      await expect(button).toHaveAttribute("aria-pressed", "false");
    }
  });
});
