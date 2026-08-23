import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { maskLiterals, scanActions } from "./support/guard-scan";

/**
 * A capability check proves the caller may edit *a* lead. It never proves they
 * may edit *this* lead - that is what the record scope is for, and for a while
 * nothing in the app applied it: `authorizeRecord` was written, exported and
 * called nowhere, while the write actions loaded leads straight from the store.
 *
 * This fails any action that reaches lead data without also authorizing the
 * record, so the next one to be added has to make the same decision
 * deliberately rather than inherit the omission.
 */

const ACTIONS_DIR = path.join(process.cwd(), "src", "app", "actions");

/** Reaching lead data: the store directly, or the projected CRM graph. */
const TOUCHES_LEADS = /\b(?:getBrandStore|getCrmGraph)\s*\(/;
const AUTHORIZES = /\bauthorizeLead\s*\(/;

/**
 * Actions that reach lead data but have no lead record to authorize. Each
 * needs a reason, because the default answer is "authorize it".
 */
const EXEMPT: readonly { file: string; fn: string; reason: string }[] = [];

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

const isExempt = (file: string, fn: string) =>
  EXEMPT.some((e) => path.basename(file) === e.file && e.fn === fn);

function violations(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const problems: string[] = [];
  for (const action of scanActions(source)) {
    if (!action.body) continue; // the guard scanner already reports unreadable bodies
    if (isExempt(file, action.name)) continue;
    if (!TOUCHES_LEADS.test(action.body.masked)) continue;
    if (AUTHORIZES.test(action.body.masked)) continue;
    problems.push(
      `${relative(file)} \u203a ${action.name} reads lead data without calling authorizeLead() - a permission check alone does not prove access to this record`,
    );
  }
  return problems;
}

describe("record scoping on writes", () => {
  it("is actually looking at the action files", () => {
    expect(FILES.length).toBeGreaterThan(0);
    const reachers = FILES.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return scanActions(source).filter((a) => a.body && TOUCHES_LEADS.test(a.body.masked));
    });
    // If this ever hits zero the regex has drifted and every check below passes vacuously.
    expect(reachers.length, "no action reaches lead data - the matcher has drifted").toBeGreaterThan(0);
  });

  it("authorizes the record in every action that reaches lead data", () => {
    const problems = FILES.flatMap(violations);
    expect(problems, `\nUnscoped lead writes:\n${problems.join("\n")}\n`).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    const existing = new Set(
      FILES.flatMap((f) => scanActions(readFileSync(f, "utf8")).map((a) => `${path.basename(f)}#${a.name}`)),
    );
    for (const e of EXEMPT) {
      expect(existing.has(`${e.file}#${e.fn}`), `${e.file} \u203a ${e.fn} is exempt but no longer exists`).toBe(true);
    }
  });
});

describe("the record-scope matcher", () => {
  it("flags an action that loads a lead and never authorizes it", () => {
    const source = `
      export async function editLead(formData: FormData): Promise<void> {
        await requirePermission("lead:update");
        const brand = await getBrandStore().get(String(formData.get("id")));
        await getBrandStore().save({ ...brand, notes: "changed" });
      }
    `;
    const masked = maskLiterals(source);
    const [action] = scanActions(source);
    expect(TOUCHES_LEADS.test(action.body!.masked)).toBe(true);
    expect(AUTHORIZES.test(action.body!.masked)).toBe(false);
    // The mention inside a string must not count as a call.
    expect(AUTHORIZES.test(maskLiterals(`const s = "authorizeLead(x)";`))).toBe(false);
    expect(masked).toContain("getBrandStore");
  });
});
