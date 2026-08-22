import { describe, it, expect } from "vitest";
import { liveIndustries } from "@/lib/industries";
import { budgetScore } from "@/lib/scoring";
import type { Brand, IndustryStat } from "@/lib/types";

const reference: IndustryStat[] = [
  {
    name: "Finance",
    opened: 14,
    companiesEU: 250,
    approachedMarket: 0.056,
    economicalEfficiency: 2.5,
    easeOfAccess: 3,
    avgBudget: 34_500,
    musicVideoFit: 4,
    valuation: "High",
  },
];

const lead = (over: Partial<Brand> = {}): Brand => ({
  id: "l", name: "L", aliases: [], status: "Early", priority: null,
  owner: null, poc: null, email: null, industry: "Finance", industryRaw: null,
  initialContact: null, lastContact: null, followUpDate: null, closingFailed: null,
  notes: null, scored: false,
  ...over,
});

const scoredLead = (id: string, industry: Brand["industry"], budget: number | null): Brand =>
  lead({
    id,
    industry,
    scored: true,
    scores: {
      tempoMonths: null, tempoScore: null, closing: null, process: null, dealsClosed: null,
      budget, assumption: "Estimated", budgetScore: budget == null ? null : budgetScore(budget),
      customizationScore: null, accessibilityRaw: null, accessibilityScore: null,
      receptivityScore: null, alignmentScore: null, industry: industry ?? "Other",
      economicalEfficiency: 3, easeOfAccess: 4,
    },
  });

const find = (rows: IndustryStat[], name: string) => rows.find((r) => r.name === name)!;

describe("liveIndustries", () => {
  it("counts the leads that exist now, not the ones in the import", () => {
    // The reported bug: adding Finance records left the Finance count at 14.
    const rows = liveIndustries(reference, [
      scoredLead("a", "Finance", 10_000),
      scoredLead("b", "Finance", 20_000),
    ]);
    expect(find(rows, "Finance").opened).toBe(2);
  });

  it("recomputes the approached share against the imported market size", () => {
    const rows = liveIndustries(reference, [scoredLead("a", "Finance", 1_000)]);
    const finance = find(rows, "Finance");
    expect(finance.companiesEU).toBe(250);
    expect(finance.approachedMarket).toBeCloseTo(1 / 250, 6);
  });

  it("keeps external research it has no way to recount", () => {
    const finance = find(liveIndustries(reference, []), "Finance");
    expect(finance.musicVideoFit).toBe(4);
    expect(finance.valuation).toBe("High");
    expect(finance.companiesEU).toBe(250);
  });

  it("reports an emptied segment as empty instead of holding the old figures", () => {
    const finance = find(liveIndustries(reference, []), "Finance");
    expect(finance.opened).toBe(0);
    expect(finance.avgBudget).toBeNull();
    expect(finance.economicalEfficiency).toBeNull();
  });

  it("averages budget over the leads that carry one", () => {
    // Dividing by every lead in the segment made a segment look cheaper the
    // less was known about it.
    const rows = liveIndustries(reference, [
      scoredLead("a", "Finance", 40_000),
      scoredLead("b", "Finance", 20_000),
      scoredLead("c", "Finance", null),
    ]);
    expect(find(rows, "Finance").avgBudget).toBe(30_000);
  });

  it("surfaces a segment that only exists in the live pipeline", () => {
    const rows = liveIndustries(reference, [scoredLead("a", "Automotive", 5_000)]);
    const automotive = find(rows, "Automotive");
    expect(automotive.opened).toBe(1);
    // No imported research for it, so no market size is claimed.
    expect(automotive.companiesEU).toBeNull();
    expect(automotive.approachedMarket).toBeNull();
  });

  it("leaves a lead with no industry out rather than filing it under Other", () => {
    const rows = liveIndustries(reference, [lead({ industry: null })]);
    expect(rows.some((r) => r.name === "Other")).toBe(false);
    expect(find(rows, "Finance").opened).toBe(0);
  });
});
