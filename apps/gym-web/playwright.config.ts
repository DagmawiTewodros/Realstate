import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run at phone width (360 px) against a running API and web app with seed data.
 * Start them with `pnpm e2e` after `pnpm db:seed` (see docs/OPERATIONS.md). BASE_URL defaults to localhost:3000.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3001",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "phone-360",
      use: { ...devices["Pixel 5"], viewport: { width: 360, height: 760 }, deviceScaleFactor: 2 },
    },
  ],
});
