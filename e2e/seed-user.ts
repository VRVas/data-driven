import { promises as fs } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { TEST_USER, SCOPED_USER } from "./constants";
import { purgeProbeData } from "./probe-data";

/**
 * Global setup - plant the E2E accounts into the local file store the same way
 * the app's own store writes it (email lower-cased, bcrypt hash cost 12).
 * Non-destructive: any other local accounts are preserved.
 *
 * Two accounts. The first sees everything. The second is restricted to its own
 * leads, which is the only way to prove that an aggregate excludes what its
 * reader cannot open - a scope that leaks into a total is silent, because the
 * total still looks like a number.
 */

/** Everything the scoped account needs, with lead reads narrowed to `own`. */
const OWN_ONLY_PROFILE = {
  id: SCOPED_USER.profileId,
  name: "E2E own-only",
  description: "Record-scope fixture: sees and edits only its own leads.",
  permissions: {
    "lead:read": "own",
    "lead:update": "own",
    "lead:create": "all",
    "proposal:read": "own",
    "proposal:manage": "own",
    "outreach:read": "own",
    "reminder:read": "own",
    "reminder:create": "all",
    "view:read": "own",
    "scoring:read": "all",
    "industry:read": "all",
    "tam:read": "all",
    "quality:read": "all",
    "copilot:use": "all",
    "copilot:tool:write": "all",
    "export:csv": "all",
  },
  system: false,
};

export default async function globalSetup() {
  const dataDir = path.join(process.cwd(), ".data");
  const usersFile = path.join(dataDir, "users.json");
  const profilesFile = path.join(dataDir, "profiles.json");
  await fs.mkdir(dataDir, { recursive: true });

  let users: Array<Record<string, unknown>> = [];
  try {
    users = JSON.parse(await fs.readFile(usersFile, "utf8"));
  } catch {
    users = [];
  }

  const email = TEST_USER.email.toLowerCase();
  const scopedEmail = SCOPED_USER.email.toLowerCase();
  const others = users.filter((u) => (u.email as string) !== email && (u.email as string) !== scopedEmail);
  others.push({
    id: "e2e-user",
    email,
    name: TEST_USER.name,
    passwordHash: bcrypt.hashSync(TEST_USER.password, 12),
    createdAt: new Date().toISOString(),
  });
  others.push({
    id: SCOPED_USER.id,
    email: scopedEmail,
    name: SCOPED_USER.name,
    passwordHash: bcrypt.hashSync(SCOPED_USER.password, 12),
    createdAt: new Date().toISOString(),
    assignment: { profileIds: [SCOPED_USER.profileId] },
  });

  await fs.writeFile(usersFile, JSON.stringify(others, null, 2), "utf8");

  let profiles: Array<Record<string, unknown>> = [];
  try {
    profiles = JSON.parse(await fs.readFile(profilesFile, "utf8"));
  } catch {
    profiles = [];
  }
  await fs.writeFile(
    profilesFile,
    JSON.stringify([...profiles.filter((p) => p.id !== SCOPED_USER.profileId), OWN_ONLY_PROFILE], null, 2),
    "utf8",
  );

  // A run killed before teardown would otherwise leave a probe lead behind,
  // and wiring.spec.ts asserts on totals it would move.
  await purgeProbeData();
  // eslint-disable-next-line no-console
  console.log(`\n[seed] e2e accounts ready: ${email}, ${scopedEmail} (own-only)`);
}
