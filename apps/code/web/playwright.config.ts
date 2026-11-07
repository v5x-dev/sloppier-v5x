import { defineConfig, devices } from "@playwright/test"

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4173"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: 2,
  expect: { timeout: 20_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    // UI_EVIDENCE=1 keeps a screenshot and video for every test, so the run
    // can be reviewed in test-results/ even when everything passes.
    screenshot: process.env.UI_EVIDENCE ? "on" : "only-on-failure",
    video: process.env.UI_EVIDENCE ? "on" : "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "bun run dev -- --host 127.0.0.1 --port 4173 --strictPort",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      },
})
