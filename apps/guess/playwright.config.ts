import { defineConfig, devices } from "@playwright/test";

// Chromium's "Chrome for Testing" download host is geo-blocked in this
// environment; Firefox downloads fine and is a legitimate real browser
// engine, so it is the local dev/CI-less browser target here. Swap/add
// chromium once a machine with CDN access runs this suite.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  outputDir: "./test-results/artifacts",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
  ],
  // Next.js's own Playwright guide recommends testing the production build:
  // next dev's HMR client can leave the page without working event handlers
  // when its websocket can't connect (as it can't in this sandbox), so
  // build once and let Playwright drive `next start` instead of `next dev`.
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3100/guess",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
