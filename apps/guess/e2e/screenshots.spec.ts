import { test } from "@playwright/test";
import path from "node:path";
import { installMockApi, defaultGameConfig } from "./mock-api";

const VIEWPORTS = [
  { name: "320x568", width: 320, height: 568 },
  { name: "375x812", width: 375, height: 812 },
  { name: "430x932", width: 430, height: 932 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080-large-desktop", width: 1920, height: 1080 },
];

const OUT_DIR = path.join(__dirname, "..", "test-results", "screenshots");

test.describe.configure({ mode: "serial" });

for (const viewport of VIEWPORTS) {
  test(`capture screens at ${viewport.name}`, async ({ page }) => {
    // Also exercises the prefers-reduced-motion CSS override (globals.css) -
    // without it these screenshots would be captured mid fade-up/fade-in.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const config = defaultGameConfig({ gameId: `game-shot-${viewport.name}` });
    await installMockApi(page, config);

    await page.goto("/guess");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: path.join(OUT_DIR, `${viewport.name}-01-home.png`), fullPage: true });

    await page.getByRole("button", { name: "שחקו את אתגר היום" }).click();
    await page.waitForURL(/\/guess\/game\//);
    const round1 = config.rounds[0]!;
    await page.getByRole("button", { name: "עוד פוסט" }).click();
    await page.getByRole("button", { name: "עוד פוסט" }).click();
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: path.join(OUT_DIR, `${viewport.name}-02-round-with-hints.png`), fullPage: true });

    const correct = round1.choices.find((c) => c.choiceId === round1.correctChoiceId)!;
    await page.getByRole("button", { name: new RegExp(correct.username) }).click();
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: path.join(OUT_DIR, `${viewport.name}-03-resolved-feedback.png`), fullPage: true });

    await page.getByRole("button", { name: "לסבב הבא" }).click();
    const round2 = config.rounds[1]!;
    const correct2 = round2.choices.find((c) => c.choiceId === round2.correctChoiceId)!;
    await page.getByRole("button", { name: new RegExp(correct2.username) }).click();
    await page.getByRole("button", { name: "לתוצאה הסופית" }).click();
    await page.waitForURL(/\/results$/);
    await page.getByRole("heading", { name: "סיימתם" }).waitFor();
    await page.screenshot({ path: path.join(OUT_DIR, `${viewport.name}-04-final-results.png`), fullPage: true });
  });
}

test("capture light mode sanity check at 1440x900", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  const config = defaultGameConfig({ gameId: "game-shot-light" });
  await installMockApi(page, config);

  await page.goto("/guess");
  await page.getByRole("button", { name: "מצב בהיר" }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(OUT_DIR, "1440x900-light-01-home.png"), fullPage: true });

  await page.getByRole("button", { name: "שחקו את אתגר היום" }).click();
  await page.waitForURL(/\/guess\/game\//);
  await page.getByRole("button", { name: "עוד פוסט" }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(OUT_DIR, "1440x900-light-02-round-with-hint.png"), fullPage: true });
});
