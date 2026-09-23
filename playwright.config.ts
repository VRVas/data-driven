import { defineConfig, devices } from "@playwright/test";
import { EXTERNAL_CLIENTS, TELEGRAM_FIXTURE } from "./e2e/constants";

/**
 * Playwright UI test harness for the OOVIE BD-intelligence platform.
 *
 *  - Boots its own dev server (file-backed stores) on a dedicated port.
 *  - `seed-user.ts` (globalSetup) plants the E2E account into .data/users.json.
 *  - `probe-data.ts` runs at both ends, removing the lead `wiring.spec.ts`
 *    creates - the E2E account is a member, and members cannot delete leads.
 *  - The `setup` project logs in once through the UI and saves the session, so
 *    the authenticated dashboard specs reuse it via `storageState`.
 *  - Functional specs run with reduced motion for deterministic, settled frames;
 *    `motion.spec.ts` opts back into full GSAP motion to exercise that path.
 */
const PORT = Number(process.env.PW_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: "./e2e/seed-user.ts",
  globalTeardown: "./e2e/probe-data.ts",

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    reducedMotion: "reduce",
    colorScheme: "dark",
  },

  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/, use: { reducedMotion: "reduce" } },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce",
        colorScheme: "dark",
      },
      dependencies: ["setup"],
    },
  ],

  webServer: {
    // Dev server: the file-backed user store is intentionally dev-only (prod
    // requires Cosmos), so auth E2E must run against `next dev`. The setup
    // project pre-warms every route so the first navigations aren't cold compiles.
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      AUTH_SECRET: process.env.AUTH_SECRET ?? "playwright-e2e-development-secret-0000000000",
      AUTH_TRUST_HOST: "true",
      APP_URL: BASE_URL,
      COPILOT_CHAT_ENDPOINT: "",
      COSMOS_ENDPOINT: "",
      COPILOT_EXTERNAL_ENABLED: "true",
      COPILOT_CLIENTS_JSON: JSON.stringify(EXTERNAL_CLIENTS),
      TELEGRAM_ENABLED: "true",
      TELEGRAM_BOT_TOKEN: `${TELEGRAM_FIXTURE.botId}:fixture-only`,
      TELEGRAM_BOT_USERNAME: "fixture_copilot_bot",
      TELEGRAM_WEBHOOK_SECRET: TELEGRAM_FIXTURE.secret,
      TELEGRAM_TEST_API_ROOT: `http://127.0.0.1:${PORT + 1}`,
    },
  },
});
