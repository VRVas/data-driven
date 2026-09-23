import path from "node:path";
import { createHash } from "node:crypto";

export const EXTERNAL_TOKENS = {
  read: "copilot.ext.e2e-read.fixtureOnlyNotAProductionToken000000000000",
  write: "copilot.ext.e2e-write.fixtureOnlyNotAProductionToken00000000000",
  other: "copilot.ext.e2e-other.fixtureOnlyNotAProductionToken00000000000",
};
export const TELEGRAM_FIXTURE = { botId: "999000111", userId: 777000111, secret: "playwright-telegram-fixture-secret-00000000000" };
export const EXTERNAL_CLIENTS = Object.entries(EXTERNAL_TOKENS).map(([mode, token]) => ({
  id: `e2e-${mode}`, name: `E2E ${mode}`, tokenSha256: createHash("sha256").update(token).digest("hex"),
  scopes: mode === "write" ? ["copilot:read", "copilot:propose", "copilot:approve"] : ["copilot:read"],
  permissions: { "copilot:use": "all", "lead:read": "all", "scoring:read": "all",
    ...(mode === "write" ? { "copilot:tool:write": "all", "lead:stage:advance": "all", "lead:update": "all" } : {}) },
  requestsPerMinute: 300,
}));

/** Credentials for the seeded E2E account (see seed-user.ts). */
export const TEST_USER = {
  email: "e2e@oovie.dev",
  password: "Password123!",
  name: "E2E Tester",
};

/**
 * A second account restricted to its OWN leads, for proving record scope.
 *
 * It needs a profile of its own rather than an override: grants merge by
 * taking the WIDER scope, so nothing can narrow a seeded profile's `all` down
 * to `own`. Its name is what leads must carry as their owner, because a lead
 * stores an owner's display name and the resolver maps that to a user id.
 */
export const SCOPED_USER = {
  email: "e2e-scoped@oovie.dev",
  password: "Password123!",
  name: "E2E Scoped",
  id: "e2e-scoped-user",
  profileId: "e2e-own-only",
};

/** Where the authenticated session is stashed for the dashboard specs. */
export const STORAGE_STATE = path.join(process.cwd(), "e2e/.auth/user.json");
export const SCOPED_STORAGE_STATE = path.join(process.cwd(), "e2e/.auth/scoped.json");

/** Directory for human-viewable screenshots captured during the run. */
export const SHOTS_DIR = path.join(process.cwd(), "e2e-artifacts/screens");
