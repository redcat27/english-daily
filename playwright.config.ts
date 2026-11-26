import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30000,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    { name: "iPhone WebKit", use: { ...devices["iPhone 13"], browserName: "webkit" } },
    { name: "Desktop Chromium", use: { ...devices["Desktop Chrome"], browserName: "chromium" } },
  ],
  webServer: {
    command: "pnpm start --port 3100",
    url: "http://127.0.0.1:3100",
    env: { DATABASE_URL: "", DIRECT_URL: "" },
    reuseExistingServer: false,
  },
});
