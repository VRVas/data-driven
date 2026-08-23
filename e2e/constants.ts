import path from "node:path";

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
