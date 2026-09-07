import { describe, it, expect } from "vitest";
import { modelSpec, workedExample } from "@/lib/copilot/model-spec";
import {
  BUDGET_CEILING,
  CONFIDENCE,
  GRADE_BANDS,
  PURSUE_OI,
  PURSUE_WI,
  WI_WEIGHTS,
  priorityOf,
} from "@/lib/priority";
import { STAGE_PROBABILITY } from "@/lib/scoring";
import { writeBudget } from "@/lib/pipeline/budget";
import { writeRubric } from "@/lib/pipeline/rubric";
import type { Brand } from "@/lib/types";

const lead = (over: Partial<Brand> = {}): Brand => ({
  id: "acme", name: "Acme", aliases: [], status: "Advanced", priority: "Medium",
  owner: "Ada", poc: null, email: null, industry: "Finance", industryRaw: null,
  initialContact: "2026-01-01", lastContact: "2026-08-01", followUpDate: null,
  closingFailed: null, notes: null, scored: false,
  ...over,
});

describe("modelSpec", () => {
  it("quotes the weights the ranking actually uses", () => {
    // Written into the system prompt, this drifts the first time a weight
    // changes. Derived from the constants, it cannot.
    const spec = modelSpec();
    expect(spec.winnability.terms.stage.weight).toBe(WI_WEIGHTS.stage);
    expect(spec.winnability.terms.recency.weight).toBe(WI_WEIGHTS.recency);
    expect(spec.opportunity.terms.moneyIndex.ceilingEur).toBe(BUDGET_CEILING);
    expect(spec.opportunity.terms.confidence.values).toEqual(CONFIDENCE);
    expect(spec.quadrant.thresholds).toEqual({ opportunity: PURSUE_OI, winnability: PURSUE_WI });
    expect(spec.winnability.terms.stage.probabilities).toEqual(STAGE_PROBABILITY);
  });

  it("describes the grade bands without gaps or overlaps", () => {
    const bands = modelSpec().priority.grades;
    expect(bands).toHaveLength(GRADE_BANDS.length);
    expect(bands[0].to).toBe(100);
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].to).toBe(bands[i - 1].from - 1);
    }
    expect(bands.at(-1)!.from).toBe(0);
  });

  it("says plainly that duration does not affect the ranking", () => {
    // The reported confusion: changing expected duration moved nothing, and
    // nothing on the platform said why.
    const excluded = modelSpec().notInTheRanking.join(" ");
    expect(excluded).toMatch(/expectedMonths/);
    expect(excluded).toMatch(/NEVER move a bubble/);
  });
});

describe("workedExample", () => {
  const scored = writeRubric(writeBudget(lead(), 40_000, "Estimated"), {
    customizationScore: 3,
    accessibilityScore: 4,
    receptivityScore: 2,
    alignmentScore: 5,
  });

  it("reproduces the real breakdown rather than a retelling of it", () => {
    const p = priorityOf(scored)!;
    const ex = workedExample(scored);
    expect(ex.rankable).toBe(true);
    expect(ex.priority).toBe(p.priority);
    expect(ex.grade).toBe(p.grade);
    expect(ex.quadrant).toBe(p.quadrant);
    expect(ex.opportunity!.result).toBe(p.opportunity);
    expect(ex.winnability!.result).toBe(p.winnability);
  });

  it("shows the arithmetic it claims, not just the answer", () => {
    const ex = workedExample(scored);
    expect(ex.arithmetic).toMatch(/^round\(sqrt\(/);
    expect(ex.opportunity!.confidence).toBe(CONFIDENCE.Estimated);
    expect(ex.opportunity!.adjustedBudgetEur).toBe(40_000 * CONFIDENCE.Estimated);
  });

  it("explains why an unrankable lead has no priority instead of returning nothing", () => {
    const ex = workedExample(lead());
    expect(ex.rankable).toBe(false);
    expect(ex.reason).toMatch(/commercial value/);
  });
});
