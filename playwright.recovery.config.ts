import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const port = Number(process.env.RECOVERY_PW_PORT ?? 3200);
export default defineConfig({
  testDir: "./e2e", testMatch: "recovery-admin.spec.ts", workers: 1, fullyParallel: false, retries: 0, timeout: 120000,
  expect: { timeout: 15000 }, reporter: [["line"]], outputDir: "test-results-recovery",
  globalSetup: "./e2e/recovery-setup.ts",
    use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${port}`, viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: "reduce" }, colorScheme: "dark", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: `npm run dev -- --turbopack --port ${port}`, url: `http://localhost:${port}/recovery`, reuseExistingServer: false, timeout: 180000,
    env: { APP_URL: `http://localhost:${port}`, APP_DATA_DIR: path.join(process.cwd(), ".data", "recovery-e2e"),
      AUTH_SECRET: "recovery-playwright-session-secret-000000000000", AUTH_TRUST_HOST: "true",
      DATA_RECOVERY_ENABLED: "true", DATA_RECOVERY_KEY: "recovery-playwright-owner-key-0000000000000000",
      COSMOS_ENDPOINT: "", COPILOT_CHAT_ENDPOINT: "", COPILOT_EXTERNAL_ENABLED: "false", TELEGRAM_ENABLED: "false", ACS_ENDPOINT: "", ACS_CONNECTION_STRING: "", REMINDER_LOOP_MINUTES: "0" },
  },
});