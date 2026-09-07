import { describe, it, expect } from "vitest";
import { checkIntake, intakeSpec, INTAKE_SPECS } from "@/lib/copilot/intake";
import { suggestLeadFields } from "@/lib/copilot/suggest";
import { COPILOT_TOOLS } from "@/lib/copilot/tools";
import type { Brand } from "@/lib/types";

describe("intake checklists", () => {
  it("names a tool that actually exists, for every checklist", () => {
    // A checklist for a tool nobody can call is advice that never arrives, and
    // one that outlives a rename is worse: it asks for fields that are gone.
    const names = new Set(COPILOT_TOOLS.map((t) => t.name));
    for (const spec of INTAKE_SPECS) {
      expect(names.has(spec.tool), `no such tool: ${spec.tool}`).toBe(true);
    }
  });

  it("asks for a field the tool actually takes", () => {
    for (const spec of INTAKE_SPECS) {
      const tool = COPILOT_TOOLS.find((t) => t.name === spec.tool)!;
      const props = Object.keys((tool.parameters as { properties?: Record<string, unknown> }).properties ?? {});
      for (const f of spec.fields) {
        expect(props, `${spec.tool} has no parameter ${f.field}`).toContain(f.field);
      }
    }
  });

  it("marks required exactly as the tool's own schema does", () => {
    // The two disagreeing is how you get a copilot that interrogates the user
    // about something optional, or calls a tool that rejects the call.
    for (const spec of INTAKE_SPECS) {
      const tool = COPILOT_TOOLS.find((t) => t.name === spec.tool)!;
      const required = new Set((tool.parameters as { required?: string[] }).required ?? []);
      for (const f of spec.fields) {
        expect(f.need === "required", `${spec.tool}.${f.field}`).toBe(required.has(f.field));
      }
    }
  });

  it("gives every field a question and a consequence", () => {
    for (const spec of INTAKE_SPECS) {
      for (const f of spec.fields) {
        expect(f.ask.length, `${spec.tool}.${f.field}`).toBeGreaterThan(8);
        expect(f.why.length, `${spec.tool}.${f.field}`).toBeGreaterThan(20);
      }
    }
  });

  it("blocks when a required field is missing", () => {
    const c = checkIntake("create_lead", {})!;
    expect(c.ready).toBe(false);
    expect(c.missingRequired.map((f) => f.field)).toEqual(["name"]);
    expect(c.guidance).toContain("Do not call the tool yet");
    expect(c.questions[0]).toBe("What is the brand called?");
  });

  it("lets a bare name through, but says what it costs", () => {
    const c = checkIntake("create_lead", { name: "Zara" })!;
    expect(c.ready).toBe(true);
    expect(c.complete).toBe(false);
    expect(c.missingImportant.map((f) => f.field).sort()).toEqual(["industry", "owner", "status", "valueEur"]);
    // The point of the whole module: proceeding is allowed and its price is stated.
    expect(c.consequences.join(" ")).toContain("cannot be ranked at all");
    expect(c.guidance).toContain("submitted as-is");
  });

  it("stops asking once everything is answered", () => {
    const c = checkIntake("create_lead", {
      name: "Zara",
      valueEur: 40000,
      owner: "Marco",
      status: "Early",
      industry: "Fashion",
      poc: "Ana",
      email: "ana@zara.com",
      priority: "High",
      nextStep: "Send the deck",
      notes: "Introduced by the Milan office",
    })!;
    expect(c.complete).toBe(true);
    expect(c.questions).toEqual([]);
    expect(c.consequences).toEqual([]);
  });

  it("treats a blank string as unanswered and false as answered", () => {
    // "No, don't hold my calendar" is an answer. Re-asking it is worse than
    // never asking, because it reads as not having listened.
    const blank = checkIntake("create_lead", { name: "Zara", owner: "   " })!;
    expect(blank.missingImportant.map((f) => f.field)).toContain("owner");

    const spec = intakeSpec("set_reminder")!;
    expect(spec.fields.some((f) => f.field === "holdMinutes")).toBe(true);
    const answered = checkIntake("set_reminder", { title: "x", dueAt: "now", holdMinutes: 0 })!;
    expect(answered.missingUseful.map((f) => f.field)).not.toContain("holdMinutes");
  });

  it("returns nothing for a tool with no checklist", () => {
    expect(checkIntake("pipeline_summary", {})).toBeNull();
    expect(intakeSpec("nope")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

const brand = (over: Partial<Brand> = {}): Brand => ({
  id: over.id ?? "x",
  name: over.name ?? "X",
  aliases: [],
  status: "Early",
  priority: null,
  owner: null,
  poc: null,
  email: null,
  industry: null,
  industryRaw: null,
  initialContact: null,
  lastContact: null,
  followUpDate: null,
  closingFailed: null,
  notes: null,
  scored: false,
  ...over,
});

const withBudget = (id: string, industry: Brand["industry"], budget: number, over: Partial<Brand> = {}) =>
  brand({
    id,
    name: id,
    industry,
    ...over,
    scores: {
      budget,
      assumption: "Estimated",
      industry: industry ?? "Other",
      tempoMonths: null,
      tempoScore: null,
      closing: null,
      process: null,
      dealsClosed: null,
      budgetScore: null,
      customizationScore: null,
      accessibilityRaw: null,
      accessibilityScore: null,
      receptivityScore: null,
      alignmentScore: null,
      economicalEfficiency: null,
      easeOfAccess: null,
    },
  });

describe("field suggestions", () => {
  const fashion = [
    withBudget("a", "Fashion", 20000, { owner: "Marco" }),
    withBudget("b", "Fashion", 40000, { owner: "Marco" }),
    withBudget("c", "Fashion", 60000, { owner: "Giulia" }),
    withBudget("d", "Fashion", 80000, { owner: "Marco" }),
    withBudget("e", "Automotive", 500000, { owner: "Luca" }),
  ];

  it("proposes the median of comparable deals, with the spread and the count", () => {
    const r = suggestLeadFields(fashion, { name: "Zara", industry: "Fashion" });
    const v = r.suggestions.find((s) => s.field === "valueEur")!;
    expect(v.value).toBe(50000);
    expect(v.sampleSize).toBe(4);
    // The Automotive outlier must not be in the basis - that is the whole
    // reason the comparison is scoped to the segment.
    expect(v.basis).toContain("4 Fashion leads");
    expect(v.basis).toContain("€20,000");
  });

  it("proposes the owner who works that segment, and says that is what it means", () => {
    const r = suggestLeadFields(fashion, { name: "Zara", industry: "Fashion" });
    const o = r.suggestions.find((s) => s.field === "owner")!;
    expect(o.value).toBe("Marco");
    expect(o.basis).toContain("3 of the 4");
    expect(o.basis).toContain("not who has capacity");
  });

  it("never overwrites something the user already said", () => {
    const r = suggestLeadFields(fashion, { name: "Zara", industry: "Fashion", owner: "Ada", valueEur: 5 });
    expect(r.suggestions.map((s) => s.field)).not.toContain("owner");
    expect(r.suggestions.map((s) => s.field)).not.toContain("valueEur");
  });

  it("warns when the same client is already in the pipeline", () => {
    const r = suggestLeadFields([...fashion, brand({ id: "zara", name: "Zara Italia S.p.A.", industry: "Fashion" })], {
      name: "Zara",
    });
    expect(r.possibleDuplicates.map((d) => d.id)).toContain("zara");
    // And having found it, it knows the segment without asking.
    expect(r.suggestions.find((s) => s.field === "industry")?.value).toBe("Fashion");
  });

  it("hands the outside world to the web instead of inventing it", () => {
    const r = suggestLeadFields([], { name: "Unknown Brand" });
    const fields = r.researchGaps.map((g) => g.field);
    expect(fields).toContain("industry");
    expect(fields).toContain("valueEur");
    expect(r.researchGaps.every((g) => g.suggestedQuery.length > 0)).toBe(true);
    expect(r.suggestions.find((s) => s.field === "valueEur")).toBeUndefined();
  });

  it("refuses to read a mood off the money", () => {
    // Priority describes how the conversation is going. Deriving it from deal
    // size would look like evidence and be nothing of the sort.
    const r = suggestLeadFields(fashion, { name: "Zara", industry: "Fashion" });
    const p = r.suggestions.find((s) => s.field === "priority")!;
    expect(p.confidence).toBe("low");
    expect(p.basis).toContain("how the conversation is going");
  });

  it("attaches evidence to every single suggestion", () => {
    const r = suggestLeadFields(fashion, { name: "Zara" });
    for (const s of r.suggestions) {
      expect(s.basis.length, s.field).toBeGreaterThan(20);
      expect(["high", "medium", "low"]).toContain(s.confidence);
    }
  });
});
