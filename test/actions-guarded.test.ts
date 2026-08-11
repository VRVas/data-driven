import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isPermissionKey } from "@/lib/auth/catalogue";

/**
 * Every exported async function in src/app/actions is a Next.js Server Action:
 * a POST endpoint the browser can reach directly, with no page or component in
 * front of it. This test reads those files from disk and fails if any of them
 * can be entered without `await requirePermission("<catalogued key>")`, so
 * shipping an unguarded action means deleting a test, not forgetting a line.
 *
 * There is no TypeScript parser available here, so the analysis is textual —
 * but only after comments, strings, template text and regex literals have been
 * blanked out, so a brace or the word "requirePermission" inside any of them
 * cannot be mistaken for code. Anything the scanner cannot delimit is reported
 * as a failure rather than skipped: it fails closed.
 */

const ACTIONS_DIR = path.join(process.cwd(), "src", "app", "actions");

/**
 * Actions that run before a session exists, and so have no permission to check.
 * Each entry is, by definition, an unauthenticated endpoint open to the
 * internet — add one only with a reason as strong as these.
 */
const PRE_AUTH_ALLOWLIST: readonly { file: string; fn: string; reason: string }[] = [
  {
    file: "auth.ts",
    fn: "loginAction",
    reason: "Sign-in itself: the caller has no session yet — this is what creates one.",
  },
  {
    file: "auth.ts",
    fn: "signupAction",
    reason: "Registration: runs before the account, and therefore any permission, exists.",
  },
];

// ---------------------------------------------------------------------------
// Masking: blank out everything that is not code, preserving every offset so
// the masked text and the original stay index-for-index aligned.
// ---------------------------------------------------------------------------

/** A `/` after one of these starts a regex literal rather than a division. */
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "case", "do", "else", "yield", "await", "throw",
]);

function maskLiterals(source: string): string {
  const out = source.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== "\n") out[k] = " ";
  };

  const regexAllowedAt = (i: number): boolean => {
    let k = i - 1;
    while (k >= 0 && /\s/.test(out[k])) k--;
    if (k < 0) return true;
    const ch = out[k];
    if ("=(,:;[!&|?+-*%~^<>{}".includes(ch)) return true;
    if (!/[A-Za-z0-9_$]/.test(ch)) return false;
    let start = k;
    while (start >= 0 && /[A-Za-z0-9_$]/.test(out[start])) start--;
    return REGEX_PRECEDING_KEYWORDS.has(out.slice(start + 1, k + 1).join(""));
  };

  /** `source[i]` opens a quoted string; returns the index just past its close. */
  const scanQuoted = (i: number): number => {
    const quote = source[i];
    let j = i + 1;
    while (j < source.length && source[j] !== quote && source[j] !== "\n") {
      j += source[j] === "\\" ? 2 : 1;
    }
    blank(i + 1, j);
    return source[j] === quote ? j + 1 : j;
  };

  /** `source[i]` opens a regex; returns the index just past it, or -1 if it isn't one. */
  const scanRegex = (i: number): number => {
    let j = i + 1;
    let inClass = false;
    while (j < source.length) {
      const c = source[j];
      if (c === "\n") return -1;
      if (c === "\\") { j += 2; continue; }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) { blank(i + 1, j); return j + 1; }
      j++;
    }
    return -1;
  };

  /**
   * Walks code, masking as it goes. With `stopAtBrace`, returns the index of the
   * first `}` that closes something it did not open — how a `${...}` ends.
   */
  const scanCode = (start: number, stopAtBrace: boolean): number => {
    let i = start;
    let depth = 0;
    while (i < source.length) {
      const c = source[i];
      const next = source[i + 1];
      if (c === "/" && next === "/") {
        let j = i + 2;
        while (j < source.length && source[j] !== "\n") j++;
        blank(i, j); i = j; continue;
      }
      if (c === "/" && next === "*") {
        const found = source.indexOf("*/", i + 2);
        const j = found === -1 ? source.length : found + 2;
        blank(i, j); i = j; continue;
      }
      if (c === '"' || c === "'") { i = scanQuoted(i); continue; }
      if (c === "`") { i = scanTemplate(i); continue; }
      if (c === "/" && regexAllowedAt(i)) {
        const end = scanRegex(i);
        if (end !== -1) { i = end; continue; }
      }
      if (c === "{") depth++;
      else if (c === "}") {
        if (depth === 0 && stopAtBrace) return i;
        depth--;
      }
      i++;
    }
    return source.length;
  };

  /**
   * `source[i]` is a backtick. Blanks the literal text but keeps `${` and its
   * closing `}` (so braces still balance) and masks the expression inside them,
   * which may itself contain further templates.
   */
  const scanTemplate = (i: number): number => {
    let j = i + 1;
    let text = j;
    while (j < source.length) {
      const c = source[j];
      if (c === "\\") { j += 2; continue; }
      if (c === "`") { blank(text, j); return j + 1; }
      if (c === "$" && source[j + 1] === "{") {
        blank(text, j);
        j = Math.min(scanCode(j + 2, true) + 1, source.length);
        text = j;
        continue;
      }
      j++;
    }
    blank(text, source.length);
    return source.length;
  };

  scanCode(0, false);
  return out.join("");
}

// ---------------------------------------------------------------------------
// Structure: find each exported async function and the exact bounds of its body
// ---------------------------------------------------------------------------

/** Index just past the `close` matching the `open` at `i`, or -1. */
function matchPair(masked: string, i: number, open: string, close: string): number {
  let depth = 0;
  for (let k = i; k < masked.length; k++) {
    if (masked[k] === open) depth++;
    else if (masked[k] === close && --depth === 0) return k + 1;
  }
  return -1;
}

function prevSignificant(masked: string, i: number): string {
  let k = i - 1;
  while (k >= 0 && /\s/.test(masked[k])) k--;
  return k >= 0 ? masked[k] : "";
}

function skipWhitespace(masked: string, i: number): number {
  let k = i;
  while (k < masked.length && /\s/.test(masked[k])) k++;
  return k;
}

/** Index just past a balanced `<...>` type-parameter list starting at `i`, or -1. */
function skipTypeParams(masked: string, i: number): number {
  let depth = 0;
  let k = i;
  while (k < masked.length) {
    const c = masked[k];
    if (c === "=" && masked[k + 1] === ">") { k += 2; continue; } // arrow in a constraint
    if (c === "(" || c === "{") {
      const end = matchPair(masked, k, c, c === "(" ? ")" : "}");
      if (end === -1) return -1;
      k = end; continue;
    }
    if (c === "<") depth++;
    else if (c === ">" && --depth === 0) return k + 1;
    k++;
  }
  return -1;
}

/** A `{` preceded by one of these belongs to a type, not to the body. */
const TYPE_LITERAL_PRECEDERS = new Set([":", "|", "&", "<", ",", "="]);

/** The `{` that opens the body, stepping over object types in the return annotation. */
function findBodyStart(masked: string, from: number): number {
  let k = from;
  while (k < masked.length) {
    const c = masked[k];
    if (c === ";") return -1; // an overload signature, which has no body
    if (c === "{") {
      if (!TYPE_LITERAL_PRECEDERS.has(prevSignificant(masked, k))) return k;
      const end = matchPair(masked, k, "{", "}");
      if (end === -1) return -1;
      k = end; continue;
    }
    k++;
  }
  return -1;
}

/** Raw source and its mask over the same range, so offsets are interchangeable. */
interface Span { raw: string; masked: string }

const sliceSpan = (s: Span, from: number, to?: number): Span => ({
  raw: s.raw.slice(from, to),
  masked: s.masked.slice(from, to),
});

function trimSpan(s: Span): Span {
  let from = 0;
  let to = s.masked.length;
  while (from < to && /\s/.test(s.masked[from])) from++;
  while (to > from && /\s/.test(s.masked[to - 1])) to--;
  return sliceSpan(s, from, to);
}

interface ScannedAction {
  name: string;
  /** null when the scanner could not delimit the body — reported, never passed. */
  body: Span | null;
}

const EXPORTED_ASYNC = /(?<![\w$.])export\s+async\s+function\s*\*?\s*([A-Za-z_$][\w$]*)/g;

function scanActions(source: string): ScannedAction[] {
  const masked = maskLiterals(source);
  const actions: ScannedAction[] = [];

  for (const match of masked.matchAll(EXPORTED_ASYNC)) {
    const name = match[1];
    let k = skipWhitespace(masked, match.index + match[0].length);
    if (masked[k] === "<") {
      k = skipTypeParams(masked, k);
      if (k === -1) { actions.push({ name, body: null }); continue; }
      k = skipWhitespace(masked, k);
    }
    const params = masked[k] === "(" ? matchPair(masked, k, "(", ")") : -1;
    const start = params === -1 ? -1 : findBodyStart(masked, params);
    const end = start === -1 ? -1 : matchPair(masked, start, "{", "}");
    actions.push({
      name,
      // Each body is measured from its own opening brace, so an earlier
      // function's braces can never be attributed to a later one.
      body: end === -1 ? null : { raw: source.slice(start, end), masked: masked.slice(start, end) },
    });
  }
  return actions;
}

// ---------------------------------------------------------------------------
// Guards: find requirePermission() calls and statically resolve the key(s)
// ---------------------------------------------------------------------------

type Guard =
  | { kind: "ok"; permissions: string[] }
  | { kind: "unknown-key"; permissions: string[] }
  | { kind: "unverifiable"; text: string }
  | { kind: "unawaited"; text: string };

const GUARD_CALL = /\brequirePermission\s*\(/g;

function isStringLiteral(expr: Span): boolean {
  const quote = expr.masked[0];
  return (
    expr.masked.length >= 2 &&
    (quote === '"' || quote === "'" || quote === "`") &&
    expr.masked[expr.masked.length - 1] === quote &&
    // Templates with interpolation are values, not literals.
    !(quote === "`" && expr.raw.includes("${"))
  );
}

/** The first top-level `?` of a ternary, ignoring `?.` and `??`. */
function ternaryQuestion(masked: string): number {
  let depth = 0;
  for (let k = 0; k < masked.length; k++) {
    const c = masked[k];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "?" && depth === 0) {
      if (masked[k + 1] === "?" || masked[k + 1] === "." || masked[k - 1] === "?") { k++; continue; }
      return k;
    }
  }
  return -1;
}

/** The `:` matching the ternary `?` at `from - 1`, allowing nested ternaries. */
function ternaryColon(masked: string, from: number): number {
  let depth = 0;
  let pending = 0;
  for (let k = from; k < masked.length; k++) {
    const c = masked[k];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0 && c === "?" && masked[k + 1] !== "?" && masked[k + 1] !== "." && masked[k - 1] !== "?") pending++;
    else if (depth === 0 && c === ":") {
      if (pending === 0) return k;
      pending--;
    }
  }
  return -1;
}

/**
 * Every permission the expression can evaluate to, or null if that cannot be
 * decided from the text. `isNew ? "agent:create" : "agent:update"` resolves to
 * both branches (the condition is irrelevant); a bare identifier resolves to
 * nothing, because a permission we cannot read is a permission we cannot check.
 */
function resolvePermissions(expr: Span): string[] | null {
  let current = trimSpan(expr);
  while (
    current.masked.startsWith("(") &&
    matchPair(current.masked, 0, "(", ")") === current.masked.length
  ) {
    current = trimSpan(sliceSpan(current, 1, current.masked.length - 1));
  }
  if (!current.masked) return null;

  const question = ternaryQuestion(current.masked);
  if (question === -1) {
    if (!isStringLiteral(current)) return null;
    return [current.raw.slice(1, -1).replace(/\\(.)/g, "$1")];
  }

  const colon = ternaryColon(current.masked, question + 1);
  if (colon === -1) return null;
  const whenTrue = resolvePermissions(sliceSpan(current, question + 1, colon));
  const whenFalse = resolvePermissions(sliceSpan(current, colon + 1));
  return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null;
}

/** The first argument of a call whose argument list is `args`. */
function firstArgument(args: Span): Span {
  let depth = 0;
  for (let k = 0; k < args.masked.length; k++) {
    const c = args.masked[k];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) return sliceSpan(args, 0, k);
  }
  return args;
}

/** An un-awaited guard resolves to a promise nobody waits for: it cannot block. */
function isAwaited(before: string): boolean {
  const trimmed = before.replace(/\s+$/, "");
  if (!trimmed.endsWith("await")) return false;
  const preceding = trimmed[trimmed.length - "await".length - 1];
  return preceding === undefined || !/[\w$.]/.test(preceding);
}

function guardsIn(body: Span): Guard[] {
  const guards: Guard[] = [];
  for (const match of body.masked.matchAll(GUARD_CALL)) {
    const open = match.index + match[0].length - 1;
    const close = matchPair(body.masked, open, "(", ")");
    const args = close === -1 ? null : firstArgument(sliceSpan(body, open + 1, close - 1));
    const text = args ? args.raw.trim() : "";
    const permissions = args ? resolvePermissions(args) : null;

    if (!isAwaited(body.masked.slice(0, match.index))) guards.push({ kind: "unawaited", text });
    else if (!permissions || permissions.length === 0) guards.push({ kind: "unverifiable", text });
    else if (!permissions.every(isPermissionKey)) guards.push({ kind: "unknown-key", permissions });
    else guards.push({ kind: "ok", permissions });
  }
  return guards;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** One line per unguarded or unverifiable action, naming the file and function. */
function guardViolations(file: string, source: string, exempt: ReadonlySet<string>): string[] {
  const problems: string[] = [];

  for (const action of scanActions(source)) {
    const where = `${file} \u203a ${action.name}`;
    if (exempt.has(action.name)) continue;

    if (!action.body) {
      problems.push(`${where} could not be read by the guard scanner — it refuses to assume the action is safe`);
      continue;
    }

    const guards = guardsIn(action.body);
    if (guards.length === 0) {
      problems.push(`${where} has no requirePermission() call`);
      continue;
    }

    for (const guard of guards) {
      if (guard.kind === "unawaited") {
        problems.push(`${where} calls requirePermission(${guard.text}) without awaiting it — the guard cannot block the call`);
      } else if (guard.kind === "unverifiable") {
        problems.push(`${where} calls requirePermission(${guard.text}) with a permission that is not a literal — it cannot be checked against the catalogue`);
      } else if (guard.kind === "unknown-key") {
        const bogus = guard.permissions.filter((p) => !isPermissionKey(p));
        problems.push(`${where} guards with requirePermission("${bogus.join('", "')}") — not in the permission catalogue`);
      }
    }
  }
  return problems;
}

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
        `${relative(file)} — the scanner found no exported async functions in a file that should contain server actions; fix the scanner rather than trusting it`,
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
        `${entry.file} \u203a ${entry.fn} is allow-listed as pre-authentication but no longer exists — delete the entry or correct the name`,
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

/** Not exported, so unreachable — its guard must not be credited to anyone else. */
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
  const hint = "requirePermission({ — a call and a brace inside a string are neither";
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
      'fixture.ts \u203a typoAction guards with requirePermission("lead:obliterate") — not in the permission catalogue',
      "fixture.ts \u203a dynamicAction calls requirePermission(key) with a permission that is not a literal — it cannot be checked against the catalogue",
      'fixture.ts \u203a forgotTheAwait calls requirePermission("lead:read") without awaiting it — the guard cannot block the call',
    ]);
  });

  it("exempts only the functions named in the allow-list", () => {
    expect(guardViolations("fixture.ts", FIXTURE, new Set(["unguardedAction"]))).toEqual([]);
    expect(guardViolations("fixture.ts", FIXTURE, new Set(["somethingElse"]))).toHaveLength(1);
  });
});
