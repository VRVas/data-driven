import path from "node:path";

/** Credentials for the seeded E2E account (see seed-user.ts). */
export const TEST_USER = {
  email: "e2e@oovie.dev",
  password: "Password123!",
  name: "E2E Tester",
};

/** Where the authenticated session is stashed for the dashboard specs. */
export const STORAGE_STATE = path.join(process.cwd(), "e2e/.auth/user.json");

/** Directory for human-viewable screenshots captured during the run. */
export const SHOTS_DIR = path.join(process.cwd(), "e2e-artifacts/screens");
