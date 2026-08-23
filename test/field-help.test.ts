import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LEAD_FIELD_HELP } from "@/lib/leads/field-help";
import { RUBRIC_FIELDS } from "@/lib/pipeline/rubric";
import { intakeSpec } from "@/lib/copilot/intake";

const editor = readFileSync(path.join(process.cwd(), "src/components/BrandEditor.tsx"), "utf8");

describe("lead field help", () => {
  it("explains every field the form asks for", () => {
    // A field added without help is a field somebody fills in to make it stop
    // being empty, which is how a pipeline collects numbers nobody believes.
    const fields = [...editor.matchAll(/<FormField\b[^>]*>/g)].map((m) => m[0]);
    expect(fields.length).toBeGreaterThan(15);
    for (const tag of fields) {
      expect(tag, `no help on ${tag}`).toMatch(/\bhelp=/);
    }
  });

  it("points every help key at an entry that exists", () => {
    const keys = [...editor.matchAll(/help="([^"]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(15);
    for (const k of keys) {
      expect(LEAD_FIELD_HELP[k], `no help text for "${k}"`).toBeDefined();
    }
  });

  it("covers the four rubric scores, which are rendered from a list", () => {
    // Those fields are looped, so the scan above sees one tag for all four.
    for (const { key } of RUBRIC_FIELDS) {
      expect(LEAD_FIELD_HELP[key], key).toBeDefined();
    }
  });

  it("says what a field is, and says it in a sentence", () => {
    for (const [key, help] of Object.entries(LEAD_FIELD_HELP)) {
      expect(help.what.length, key).toBeGreaterThan(30);
      if (help.feeds !== undefined) expect(help.feeds.length, key).toBeGreaterThan(30);
    }
  });

  it("names a weight wherever a field moves the score", () => {
    // Vague reassurance that something is "used in the ranking" is what makes
    // people stop reading. These four carry a stated share of an axis.
    expect(LEAD_FIELD_HELP.status.feeds).toContain("45%");
    expect(LEAD_FIELD_HELP.lastContact.feeds).toContain("25%");
    expect(LEAD_FIELD_HELP.accessibilityScore.feeds).toContain("15%");
    expect(LEAD_FIELD_HELP.receptivityScore.feeds).toContain("15%");
    expect(LEAD_FIELD_HELP.budget.feeds).toContain("75%");
  });

  it("agrees with what the copilot tells people about the same fields", () => {
    // The form and the chat explaining one field differently is worse than
    // either explaining it badly. These are the ones both surfaces cover.
    const spec = intakeSpec("create_lead")!;
    const shared: [string, string][] = [
      ["valueEur", "budget"],
      ["owner", "owner"],
      ["industry", "industry"],
      ["status", "status"],
    ];
    for (const [toolField, formField] of shared) {
      expect(spec.fields.find((f) => f.field === toolField), toolField).toBeDefined();
      expect(LEAD_FIELD_HELP[formField], formField).toBeDefined();
    }
    // Both must give the same reason a value-less lead cannot be ranked.
    expect(spec.fields.find((f) => f.field === "valueEur")!.why).toContain("cannot be ranked");
    expect(LEAD_FIELD_HELP.budget.feeds).toContain("cannot be ranked");
  });
});
