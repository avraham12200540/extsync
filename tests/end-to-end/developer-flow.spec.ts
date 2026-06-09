import { test, expect } from "@playwright/test";

// Site-level e2e: register -> (verify via API/seed) -> login -> create project.
// Requires the stack running (docker compose up, migrate, seed). The Agent /
// Chrome parts are covered by manual tests (see docs/security/manual-chrome-tests.md).

const unique = Date.now();
const email = `e2e_${unique}@example.com`;
const password = "Sup3r-Secret-E2E!";

test("home page renders and links to register", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("ExtSync")).toBeVisible();
  await expect(page.getByRole("link", { name: /הרשמה/ })).toBeVisible();
});

test("developer can register and reach login", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("שם תצוגה").fill("E2E Dev");
  await page.getByLabel("אימייל").fill(email);
  await page.getByLabel("סיסמה").fill(password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /הרשמה/ }).click();
  await expect(page.getByText(/אימות הכתובת|כמעט סיימנו/)).toBeVisible();
});

test("login with the seeded developer and create a project", async ({ page }) => {
  // Uses the seed developer (make seed prints the password; default below for CI seed).
  const devEmail = process.env.DEV_EMAIL || "dev@extsync.local";
  const devPassword = process.env.DEV_PASSWORD;
  test.skip(!devPassword, "set DEV_PASSWORD from `make seed` output to run this");

  await page.goto("/login");
  await page.getByLabel("אימייל").fill(devEmail);
  await page.getByLabel("סיסמה").fill(devPassword!);
  await page.getByRole("button", { name: /התחברות/ }).click();
  await page.waitForURL("**/app");

  await page.goto("/app/projects");
  await page.getByRole("button", { name: /תוסף חדש/ }).click();
  await page.getByPlaceholder(/My Cool Extension/).fill(`E2E Ext ${unique}`);
  await page.getByRole("button", { name: /^יצירה$/ }).click();
  await expect(page.getByText(`E2E Ext ${unique}`)).toBeVisible();
});
