import { promises as fs } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { TEST_USER } from "./constants";
import { purgeProbeData } from "./probe-data";

/**
 * Global setup - plant the E2E account into the local file store the same way
 * the app's own store writes it (email lower-cased, bcrypt hash cost 12).
 * Non-destructive: any other local accounts are preserved.
 */
export default async function globalSetup() {
  const dataDir = path.join(process.cwd(), ".data");
  const usersFile = path.join(dataDir, "users.json");
  await fs.mkdir(dataDir, { recursive: true });

  let users: Array<Record<string, unknown>> = [];
  try {
    users = JSON.parse(await fs.readFile(usersFile, "utf8"));
  } catch {
    users = [];
  }

  const email = TEST_USER.email.toLowerCase();
  const others = users.filter((u) => (u.email as string) !== email);
  others.push({
    id: "e2e-user",
    email,
    name: TEST_USER.name,
    passwordHash: bcrypt.hashSync(TEST_USER.password, 12),
    createdAt: new Date().toISOString(),
  });

  await fs.writeFile(usersFile, JSON.stringify(others, null, 2), "utf8");
  // A run killed before teardown would otherwise leave a probe lead behind,
  // and wiring.spec.ts asserts on totals it would move.
  await purgeProbeData();
  // eslint-disable-next-line no-console
  console.log(`\n[seed] e2e account ready: ${email}`);
}
