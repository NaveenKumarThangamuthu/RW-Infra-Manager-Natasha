import { defineConfig, devices } from "@playwright/test";

// Playwright config — smoke tests for Natasha design-v2.
// Assumes the server is already running on http://localhost:3000.
// Credentials come from env: E2E_USER + E2E_PASS. Do NOT hard-code.

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
