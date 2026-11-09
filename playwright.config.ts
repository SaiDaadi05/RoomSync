import { defineConfig, devices } from "@playwright/test";

// Phone-sized smoke tests against a production build. Start the app first (CI does this),
// or set E2E_BASE_URL. Needs a seeded database (npm run db:seed).
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    ...devices["iPhone 13"],
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "off",
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  projects: [{ name: "phone", use: { browserName: "chromium" } }],
});
