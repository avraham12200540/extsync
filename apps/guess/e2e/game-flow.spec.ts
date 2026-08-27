import { test, expect } from "@playwright/test";
import { installMockApi, defaultGameConfig } from "./mock-api";

const ALL_USERNAMES = defaultGameConfig().rounds.flatMap((r) => r.choices.map((c) => c.username));

function trackConsoleErrors(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

test.describe("daily game golden path", () => {
  test("home -> daily -> hint -> wrong guess -> correct -> next round -> completion -> answer-free results", async ({ page }) => {
    const consoleErrors = trackConsoleErrors(page);
    const config = defaultGameConfig();
    await installMockApi(page, config);

    await page.goto("/guess");
    await expect(page.getByRole("heading", { name: "מי כתב את זה?" })).toBeVisible();

    await page.getByRole("button", { name: "שחקו את אתגר היום" }).click();
    await page.waitForURL(/\/guess\/game\/game-fixture-1$/);

    // Round 1: one post visible, four choice buttons, none marked correct yet.
    const round1 = config.rounds[0]!;
    await expect(page.getByText(round1.posts[0]!)).toBeVisible();
    await expect(page.getByText(round1.posts[1]!)).not.toBeVisible();
    for (const choice of round1.choices) {
      await expect(page.getByRole("button", { name: new RegExp(choice.username) })).toBeVisible();
    }

    // Hint accumulates below the first post rather than replacing it.
    await page.getByRole("button", { name: "עוד פוסט" }).click();
    await expect(page.getByText(round1.posts[0]!)).toBeVisible();
    await expect(page.getByText(round1.posts[1]!)).toBeVisible();

    // Wrong guess: round stays active, no correctness indicator leaks yet.
    const wrongChoice = round1.choices.find((c) => c.choiceId !== round1.correctChoiceId)!;
    await page.getByRole("button", { name: new RegExp(wrongChoice.username) }).click();
    await expect(page.getByText("לא נכון, נסו שוב")).toBeVisible();
    await expect(page.getByRole("button", { pressed: true })).toHaveCount(0);

    // Correct guess resolves the round and reveals feedback.
    const correctChoice = round1.choices.find((c) => c.choiceId === round1.correctChoiceId)!;
    await page.getByRole("button", { name: new RegExp(correctChoice.username) }).click();
    await expect(page.getByText(/^נכון/)).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(correctChoice.username) })).toHaveAttribute("aria-pressed", "true");

    // Advance to round 2 - progress indicator updates, new post shown, old round's posts gone.
    await page.getByRole("button", { name: "לסבב הבא" }).click();
    const round2 = config.rounds[1]!;
    await expect(page.getByText("סבב 2 מתוך 2")).toBeVisible();
    await expect(page.getByText(round2.posts[0]!)).toBeVisible();
    await expect(page.getByText(round1.posts[0]!)).not.toBeVisible();

    const round2Correct = round2.choices.find((c) => c.choiceId === round2.correctChoiceId)!;
    await page.getByRole("button", { name: new RegExp(round2Correct.username) }).click();
    await expect(page.getByText(/^נכון/)).toBeVisible();

    await page.getByRole("button", { name: "לתוצאה הסופית" }).click();
    await page.waitForURL(/\/guess\/game\/game-fixture-1\/results$/);
    await expect(page.getByRole("heading", { name: "סיימתם" })).toBeVisible();
    await expect(page.getByText(/ניקוד סופי: \d+/)).toBeVisible();

    // Answer-free: none of the round usernames leak into the results page HTML.
    const resultsHtml = await page.content();
    for (const username of ALL_USERNAMES) {
      expect(resultsHtml).not.toContain(username);
    }

    expect(consoleErrors, `unexpected console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
  });

  test("share button never leaks usernames or choices into shared text", async ({ page, context }) => {
    const config = defaultGameConfig();
    await installMockApi(page, config);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});

    await page.goto("/guess");
    await page.getByRole("button", { name: "שחקו את אתגר היום" }).click();
    await page.waitForURL(/\/guess\/game\//);

    for (const round of config.rounds) {
      const correct = round.choices.find((c) => c.choiceId === round.correctChoiceId)!;
      await page.getByRole("button", { name: new RegExp(correct.username) }).click();
      await expect(page.getByText(/^נכון/)).toBeVisible();
      const isLast = round.orderInGame === config.totalRounds;
      await page.getByRole("button", { name: isLast ? "לתוצאה הסופית" : "לסבב הבא" }).click();
    }
    await page.waitForURL(/\/results$/);

    let capturedShareText: string | null = null;
    await page.exposeFunction("__captureShare", (text: string) => {
      capturedShareText = text;
    });
    await page.evaluate(() => {
      navigator.share = async (data: ShareData) => {
        await (window as unknown as { __captureShare: (text: string) => Promise<void> }).__captureShare(data.text ?? "");
      };
    });

    await page.getByRole("button", { name: "שתפו את התוצאה" }).click();
    await expect.poll(() => capturedShareText).not.toBeNull();
    for (const username of ALL_USERNAMES) {
      expect(capturedShareText).not.toContain(username);
    }
    expect(capturedShareText).toMatch(/\d+/);
  });

  test("keyboard-only operation: tab to a choice button and activate with Enter", async ({ page }) => {
    const config = defaultGameConfig();
    await installMockApi(page, config);

    await page.goto("/guess");
    await page.getByRole("button", { name: "שחקו את אתגר היום" }).click();
    await page.waitForURL(/\/guess\/game\//);

    const round1 = config.rounds[0]!;
    const correct = round1.choices.find((c) => c.choiceId === round1.correctChoiceId)!;
    const correctButton = page.getByRole("button", { name: new RegExp(correct.username) });
    await correctButton.focus();
    await expect(correctButton).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText(/^נכון/)).toBeVisible();
  });

  test("free play starts a game without the daily label", async ({ page }) => {
    const config = defaultGameConfig({ gameId: "game-freeplay-1", mode: "freeplay" });
    await installMockApi(page, config);

    await page.goto("/guess");
    await page.getByRole("button", { name: "התחילו לשחק" }).click();
    await page.waitForURL(/\/guess\/game\/game-freeplay-1$/);
    await expect(page.getByText("מי כתב את זה?").first()).toBeVisible();
  });
});
