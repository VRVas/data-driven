import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { guardViolations, guardsIn, scanActions } from "./support/guard-scan";

/**
 * Every exported async function in src/app/actions is a Next.js Server Action:
 * a POST endpoint the browser can reach directly, with no page or component in
 * front of it. This test reads those files from disk and fails if any of them
 * can be entered without `await requirePermission("<catalogued key>")`, so
 * shipping an unguarded action means deleting a test, not forgetting a line.
 *
 * The scanner lives in ./support/guard-scan and is proved at the bottom of this
 * file against source that can be checked by eye.
 */

const ACTIONS_DIR = path.join(process.cwd(), "src", "app", "actions");

/**
 * Actions that run before a session exists, and so have no permission to check.
 * Each entry is, by definition, an unauthenticated endpoint open to the
 * internet - add one only with a reason as strong as these.
 */
const PRE_AUTH_ALLOWLIST: readonly { file: string; fn: string; reason: string }[] = [
  {
    file: "auth.ts",
    fn: "loginAction",
    reason: "Sign-in itself: the caller has no session yet - this is what creates one.",
  },
  {
    file: "auth.ts",
    fn: "signupAction",
    reason: "Registration: runs before the account, and therefore any permission, exists.",
  },
  {
    file: "auth.ts",
    fn: "requestLoginCode",
    reason: "Emails a sign-in code to someone who has no session yet. Rate limited, and answers identically whether or not the address is registered.",
  },
  {
    file: "auth.ts",
    fn: "requestPasswordReset",
    reason: "Password recovery: by definition the caller cannot authenticate. Same reply either way, so it is not an account oracle.",
  },
  {
    file: "auth.ts",
    fn: "resetPassword",
    reason: "Consumes a single-use emailed token; possession of that token IS the authentication.",
  },
];

// ---------------------------------------------------------------------------
// The repository itself
// ---------------------------------------------------------------------------

function actionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return actionFiles(full);
      return entry.name.endsWith(".ts") ? [full] : [];
    })
    .sort();
}

const relative = (file: string) => path.relative(process.cwd(), file).split(path.sep).join("/");

const FILES = actionFiles(ACTIONS_DIR);

const exemptIn = (file: string) =>
  new Set(
    PRE_AUTH_ALLOWLIST.filter((entry) => path.basename(file) === entry.file).map((entry) => entry.fn),
  );

describe("server actions", () => {
  it("is actually looking at the action files", () => {
    // Guards the guard: a wrong path or a broken matcher would otherwise let
    // every check below pass by finding nothing at all.
    expect(FILES.length, `no .ts files under ${relative(ACTIONS_DIR)}`).toBeGreaterThan(0);
    for (const file of FILES) {
      const found = scanActions(readFileSync(file, "utf8"));
      expect(
        found.length,
        `${relative(file)} - the scanner found no exported async functions in a file that should contain server actions; fix the scanner rather than trusting it`,
      ).toBeGreaterThan(0);
    }
  });

  it("gates every exported action behind a catalogued permission", () => {
    const problems = FILES.flatMap((file) =>
      guardViolations(relative(file), readFileSync(file, "utf8"), exemptIn(file)),
    );
    expect(problems, `\nUnguarded server actions:\n${problems.join("\n")}\n`).toEqual([]);
  });

  it("keeps the pre-authentication allow-list honest", () => {
    const existing = new Set(
      FILES.flatMap((file) =>
        scanActions(readFileSync(file, "utf8")).map((a) => `${path.basename(file)}#${a.name}`),
      ),
    );
    for (const entry of PRE_AUTH_ALLOWLIST) {
      expect(
        existing.has(`${entry.file}#${entry.fn}`),
        `${entry.file} \u203a ${entry.fn} is allow-listed as pre-authentication but no longer exists - delete the entry or correct the name`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The scanner, proved against source it can be checked by eye
// ---------------------------------------------------------------------------

/** Every trap the real files could contain, in one string: no fixture files on disk. */
const FIXTURE = `"use server";

import { requirePermission } from "@/lib/auth/authorize";

/** Not exported, so unreachable - its guard must not be credited to anyone else. */
async function loadThings(): Promise<{ items: string[] }> {
  await requirePermission("lead:read");
  return { items: [] };
}

export async function guardedAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ ok: boolean }> {
  await requirePermission("lead:update");
  const rows = [1, 2].map((n) => {
    return { n, label: \`row \${n} of {\` };
  });
  // A comment mentioning requirePermission("lead:delete") is not a guard.
  const braces = /^\\{[a-z]{2,}\\}$/;
  return { ok: rows.length > 0 && braces.test(String(formData.get("x"))) };
}

export async function typedAction<T extends { id: string }>(input: T): Promise<T> {
  await requirePermission(input.id === "new" ? "agent:create" : "agent:update");
  return input;
}

export async function unguardedAction(formData: FormData): Promise<{ ok: boolean }> {
  const hint = "requirePermission({ - a call and a brace inside a string are neither";
  return { ok: formData.has(hint) };
}

export async function alsoGuardedAction(): Promise<void> {
  await requirePermission("outreach:send", "all");
}
`;

const BROKEN_GUARDS = `"use server";

export async function typoAction(): Promise<void> {
  await requirePermission("lead:obliterate");
}

export async function dynamicAction(key: string): Promise<void> {
  await requirePermission(key);
}

export async function forgotTheAwait(): Promise<void> {
  requirePermission("lead:read");
}
`;

describe("the guard scanner itself", () => {
  it("flags the unguarded action and nothing else", () => {
    expect(guardViolations("fixture.ts", FIXTURE, new Set())).toEqual([
      "fixture.ts \u203a unguardedAction has no requirePermission() call",
    ]);
  });

  it("reads the guards it does accept", () => {
    const guards = scanActions(FIXTURE).map((a) => ({
      name: a.name,
      permissions: a.body ? guardsIn(a.body).flatMap((g) => ("permissions" in g ? g.permissions : [])) : null,
    }));
    expect(guards).toEqual([
      { name: "guardedAction", permissions: ["lead:update"] },
      // Both branches of a conditional guard are resolved and checked.
      { name: "typedAction", permissions: ["agent:create", "agent:update"] },
      { name: "unguardedAction", permissions: [] },
      { name: "alsoGuardedAction", permissions: ["outreach:send"] },
    ]);
  });

  it("rejects guards that cannot hold", () => {
    expect(guardViolations("fixture.ts", BROKEN_GUARDS, new Set())).toEqual([
      'fixture.ts \u203a typoAction guards with requirePermission("lead:obliterate") - not in the permission catalogue',
      "fixture.ts \u203a dynamicAction calls requirePermission(key) with a permission that is not a literal - it cannot be checked against the catalogue",
      'fixture.ts \u203a forgotTheAwait calls requirePermission("lead:read") without awaiting it - the guard cannot block the call',
    ]);
  });

  it("exempts only the functions named in the allow-list", () => {
    expect(guardViolations("fixture.ts", FIXTURE, new Set(["unguardedAction"]))).toEqual([]);
    expect(guardViolations("fixture.ts", FIXTURE, new Set(["somethingElse"]))).toHaveLength(1);
  });
});
