import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against a production build with a freshly migrated + seeded test DB:
 *   DATABASE_URL=postgresql://.../legacy_e2e npm run test:e2e
 */
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false, // one shared database
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `npm run build && npx prisma migrate reset --force && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { APP_URL: `http://localhost:${PORT}`, APP_TODAY: "2026-09-27", PAYMENTS_PROVIDER: "mock", CRON_SECRET: "e2e-secret", ALLOW_MOCK_PAYMENTS_IN_PRODUCTION: "true" },
  },
});
