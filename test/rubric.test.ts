import { describe, it, expect } from "vitest";
import { writeRubric, blankScores, RUBRIC_FIELDS } from "@/lib/pipeline/rubric";
import { priorityOf } from "@/lib/priority";
import type { Brand } from "@/lib/types";

const lead = (over: Partial<Brand> = {}): Brand => ({
  id: "l1", name: "L", aliases: [], status: "Advanced", priority: null,
  owner: null, poc: null, email: null, industry: "Fashion", industryRaw: null,
  initialContact: null, lastContact: null, followUpDate: null, closingFailed: null,
  notes: null, scored: false,
  ...over,
});

const ALL_THREE = { customizationScore: 3, accessibilityScore: 4, receptivityScore: 2, alignmentScore: 5 };
const NONE = {
  customizationScore: null,
  accessibilityScore: null,
  receptivityScore: null,
  alignmentScore: null,
};

describe("blankScores", () => {
  it("claims nothing except the industry it was given", () => {
    const s = blankScores(lead());
    expect(s.industry).toBe("Fashion");
    for (const { key } of RUBRIC_FIELDS) expect(s[key]).toBeNull();
    expect(s.budget).toBeNull();
  });

  it("falls back to Other when the lead has no industry", () => {
    expect(blankScores(lead({ industry: null })).industry).toBe("Other");
  });
});

describe("writeRubric", () => {
  it("records judgements on a lead that was never scored", () => {
    const after = writeRubric(lead(), ALL_THREE);
    expect(after.scores!.accessibilityScore).toBe(4);
    expect(after.scored).toBe(true);
  });

  it("recomputes ease of access from what was just entered", () => {
    const s = writeRubric(lead(), ALL_THREE).scores!;
    expect(s.easeOfAccess).toBeCloseTo((4 + 5 + 2) / 3, 6);
  });

  it("leaves economical efficiency unknown until budget and pace exist too", () => {
    // It averages budget, customization and tempo — two of the three are set
    // elsewhere, and averaging over what happens to be present would invent a
    // number.
    expect(writeRubric(lead(), ALL_THREE).scores!.economicalEfficiency).toBeNull();
  });

  it("feeds winnability, which is the reason these are editable at all", () => {
    const bare = writeRubric(lead(), { ...NONE, customizationScore: 1 });
    const reachable = writeRubric(lead(), { ...NONE, accessibilityScore: 5, receptivityScore: 5 });
    expect(priorityOf(reachable)!.winnability).toBeGreaterThan(priorityOf(bare)!.winnability);
  });

  it("says nothing rather than inventing a record when nothing was entered", () => {
    const l = lead();
    expect(writeRubric(l, NONE)).toBe(l);
  });

  it("returns the same object when no judgement moved", () => {
    const scored = writeRubric(lead(), ALL_THREE);
    expect(writeRubric(scored, ALL_THREE)).toBe(scored);
  });

  it("clears a withdrawn judgement but keeps the last computable aggregate", () => {
    // The import averaged over whichever sub-scores it had, so some leads carry
    // an easeOfAccess with a null underneath it. Nulling the aggregate whenever
    // one input goes missing would throw that away.
    const scored = writeRubric(lead(), ALL_THREE);
    const after = writeRubric(scored, { ...ALL_THREE, alignmentScore: null });
    expect(after.scores!.alignmentScore).toBeNull();
    expect(after.scores!.easeOfAccess).toBeCloseTo((4 + 5 + 2) / 3, 6);
  });
});
