import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROUTE_GUARDS, guardViolations, maskLiterals, scanActions } from "./support/guard-scan";

/**
 * Route handlers under src/app/api are POST/GET endpoints the browser reaches
 * directly, exactly like server actions - but they were not covered by the
 * action scanner, so the API surface was both unguarded and unpoliced. This
 * test closes that: every exported HTTP handler must gate on a catalogued
 * permission via `apiPermission`.
 *
 * It also refuses to be evaded. A handler exported in a form the scanner
 * cannot read - `export const POST = async () => {}`, or a destructured
 * re-export - is reported rather than skipped, so the way to ship an unguarded
 * route is to edit this file, not to pick a different syntax.
 */

const API_DIR = path.join(process.cwd(), "src", "app", "api");

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

/**
 * Handlers that cannot require a permission, with the reason. Each entry is by
 * definition an endpoint open to the internet.
 */
const PRE_AUTH_ALLOWLIST: readonly { route: string; handlers: readonly string[]; reason: string }[] = [
  {
    route: "src/app/api/auth/[...nextauth]/route.ts",
    handlers: ["GET", "POST"],
    reason:
      "Auth.js itself - the sign-in, callback and session endpoints. This is what creates a session, so it cannot require one.",
  },
  {
    route: "src/app/api/reminders/dispatch/route.ts",
    handlers: ["POST"],
    reason:
      "Called by a scheduler, not a person, so there is no session to hold a permission. Guarded instead by REMINDER_DISPATCH_KEY, compared in constant time, and it refuses outright when that key is unset - an open endpoint that sends email is a spam relay, so the default is deny.",
  },
];

// ---------------------------------------------------------------------------
// Finding handlers, in whatever form they are exported
// ---------------------------------------------------------------------------

const METHOD_ALTERNATION = HTTP_METHODS.join("|");

/** `export [async] function GET` and `export const GET =` alike. */
const DIRECT_EXPORT = new RegExp(
  `\\bexport\\s+(?:async\\s+)?(?:function\\s*\\*?\\s*|const\\s+|let\\s+|var\\s+)(${METHOD_ALTERNATION})\\b`,
  "g",
);

/** `export const { GET, POST } = handlers` - a re-export with no body here. */
const DESTRUCTURED_EXPORT = /\bexport\s+(?:const|let|var)\s*\{([^}]*)\}/g;

/** Every HTTP method this file exports, however it chose to do it. */
function exportedHandlers(masked: string): Set<string> {
  const found = new Set<string>();
  for (const m of masked.matchAll(DIRECT_EXPORT)) found.add(m[1]);
  for (const m of masked.matchAll(DESTRUCTURED_EXPORT)) {
    for (const part of m[1].split(",")) {
      const name = part.split(":").pop()!.trim();
      if ((HTTP_METHODS as readonly string[]).includes(name)) found.add(name);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// The repository itself
// ---------------------------------------------------------------------------

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return routeFiles(full);
      return entry.name === "route.ts" ? [full] : [];
    })
    .sort();
}

const relative = (file: string) => path.relative(process.cwd(), file).split(path.sep).join("/");

const FILES = routeFiles(API_DIR);

const exemptIn = (file: string): ReadonlySet<string> =>
  new Set(
    PRE_AUTH_ALLOWLIST.filter((entry) => entry.route === relative(file)).flatMap((entry) => [...entry.handlers]),
  );

/** Handlers exported in a shape the guard scanner cannot open and read. */
function unreadableHandlers(file: string, source: string): string[] {
  const exempt = exemptIn(file);
  const scannable = new Set(scanActions(source).map((a) => a.name));
  return [...exportedHandlers(maskLiterals(source))]
    .filter((method) => !exempt.has(method) && !scannable.has(method))
    .map(
      (method) =>
        `${relative(file)} \u203a ${method} is exported in a form the guard scanner cannot read - declare it as \`export async function ${method}\` so its guard can be verified`,
    );
}

describe("api route handlers", () => {
  it("is actually looking at the route files", () => {
    // Guards the guard: a wrong path would otherwise let every check below
    // pass by finding nothing at all.
    expect(FILES.length, `no route.ts files under ${relative(API_DIR)}`).toBeGreaterThan(0);
    for (const file of FILES) {
      expect(
        exportedHandlers(maskLiterals(readFileSync(file, "utf8"))).size,
        `${relative(file)} - no HTTP handler found in a file Next.js will serve as an endpoint; fix the scanner rather than trusting it`,
      ).toBeGreaterThan(0);
    }
  });

  it("gates every exported handler behind a catalogued permission", () => {
    const problems = FILES.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      // Only HTTP handlers are endpoints; other exports are helpers.
      const isHandler = (name: string) => (HTTP_METHODS as readonly string[]).includes(name);
      const skip = new Set([
        ...exemptIn(file),
        ...scanActions(source).map((a) => a.name).filter((n) => !isHandler(n)),
      ]);
      return [
        ...unreadableHandlers(file, source),
        ...guardViolations(relative(file), source, skip, ROUTE_GUARDS),
      ];
    });
    expect(problems, `\nUnguarded API routes:\n${problems.join("\n")}\n`).toEqual([]);
  });

  it("keeps the pre-authentication allow-list honest", () => {
    for (const entry of PRE_AUTH_ALLOWLIST) {
      const file = FILES.find((f) => relative(f) === entry.route);
      expect(file, `${entry.route} is allow-listed as pre-authentication but no longer exists`).toBeDefined();
      const exported = exportedHandlers(maskLiterals(readFileSync(file!, "utf8")));
      for (const handler of entry.handlers) {
        expect(
          exported.has(handler),
          `${entry.route} \u203a ${handler} is allow-listed but is no longer exported - remove the entry`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The handler finder, proved against source that can be checked by eye
// ---------------------------------------------------------------------------

describe("the route handler finder", () => {
  it("finds handlers however they are exported", () => {
    const source = `
      export async function GET() {}
      export const POST = async () => {};
      export const { PUT, DELETE } = handlers;
      // Renaming decides the exported name: the first is not a handler, the
      // second is, whatever it was called on the way in.
      export const { PATCH: notAnEndpoint } = other;
      export const { something: HEAD } = other;
      export async function helper() {}
      const OPTIONS = "not exported";
      // export function OPTIONS() {} in a comment is not an export
      const hint = "export function OPTIONS() {}";
    `;
    expect([...exportedHandlers(maskLiterals(source))].sort()).toEqual([
      "DELETE",
      "GET",
      "HEAD",
      "POST",
      "PUT",
    ]);
  });

  it("reports a handler the scanner cannot read rather than passing it", () => {
    const source = `export const POST = async () => { return Response.json({}); };`;
    expect(unreadableHandlers("src/app/api/x/route.ts", source)).toEqual([
      "src/app/api/x/route.ts \u203a POST is exported in a form the guard scanner cannot read - declare it as `export async function POST` so its guard can be verified",
    ]);
  });
});
