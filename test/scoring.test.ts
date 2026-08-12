import { describe, it, expect } from "vitest";
import {
  tempoScore,
  budgetScore,
  economicalEfficiency,
  easeOfAccess,
  leadScore,
  quadrant,
  winProbability,
  weightedValue,
  STATUS_TOKEN,
  PRIORITY_TOKEN,
  valuationToken,
  eur,
} from "@/lib/scoring";
import { BRAND_STATUSES, PRIORITIES, AGENT_STATUSES } from "@/lib/vocab";
import type { Brand } from "@/lib/types";

describe("component scores", () => {
  it("tempoScore inverts months (fresher = higher), clamped 0–5", () => {
    expect(tempoScore(0)).toBe(5);
    expect(tempoScore(8)).toBe(0);
    expect(tempoScore(4)).toBeCloseTo(2.5);
    expect(tempoScore(100)).toBe(0);
  });

  it("budgetScore maps €0–80k onto 0–5", () => {
    expect(budgetScore(0)).toBe(0);
    expect(budgetScore(10000)).toBe(0.5); // 1–16k band
    expect(budgetScore(80000)).toBe(5);
    expect(budgetScore(40000)).toBeCloseTo(2.5);
  });

  it("aggregates return null if any component is missing", () => {
    expect(economicalEfficiency({ budgetScore: 3, customizationScore: 3, tempoScore: 3 })).toBe(3);
    expect(economicalEfficiency({ budgetScore: null, customizationScore: 3, tempoScore: 3 })).toBeNull();
    expect(easeOfAccess({ accessibilityScore: 4, alignmentScore: 5, receptivityScore: 3 })).toBe(4);
  });
});

function brand(partial: Partial<Brand["scores"]> & { status?: Brand["status"] } = {}): Brand {
  const { status = null, ...scores } = partial;
  return {
    id: "x", name: "X", aliases: [], scored: true, status,
    priority: null, owner: null, poc: null, email: null, industry: null, industryRaw: null,
    initialContact: null, lastContact: null, followUpDate: null, closingFailed: null, notes: null,
    scores: {
      tempoMonths: null, tempoScore: null, closing: null, process: null, dealsClosed: null,
      budget: null, assumption: null, budgetScore: null, customizationScore: null,
      accessibilityRaw: null, accessibilityScore: null, receptivityScore: null, alignmentScore: null,
      industry: "Finance", economicalEfficiency: null, easeOfAccess: null, ...scores,
    },
  };
}

describe("leadScore + quadrant", () => {
  it("blends efficiency (0.55) and access (0.45)", () => {
    expect(leadScore(brand({ economicalEfficiency: 4, easeOfAccess: 2 }))).toBeCloseTo(3.1);
    expect(leadScore(brand({ economicalEfficiency: null }))).toBeNull();
  });

  it("classifies the four quadrants around the midpoint", () => {
    expect(quadrant(3, 3)).toBe("Prioritize");
    expect(quadrant(2, 3)).toBe("Quick Win");
    expect(quadrant(3, 2)).toBe("Strategic");
    expect(quadrant(2, 2)).toBe("Deprioritize");
  });
});

describe("pipeline weighting", () => {
  it("maps stages to win probability", () => {
    expect(winProbability("Deal Closed")).toBe(1);
    expect(winProbability("Did not work out")).toBe(0);
    expect(winProbability(null)).toBe(0);
  });

  it("weightedValue = budget × probability", () => {
    expect(weightedValue(brand({ budget: 40000, status: "Advanced" }))).toBe(24000);
    expect(weightedValue(brand({ budget: 40000, status: "Deal Closed" }))).toBe(40000);
    expect(weightedValue(brand({ budget: 40000, status: "Did not work out" }))).toBe(0);
  });
});

describe("presentation tokens", () => {
  it("has a colour for every brand status and priority", () => {
    for (const s of BRAND_STATUSES) expect(STATUS_TOKEN[s]).toMatch(/^var\(/);
    for (const p of PRIORITIES) expect(PRIORITY_TOKEN[p]).toMatch(/^var\(/);
  });

  it("agent statuses are a subset of brand statuses (so tokens resolve)", () => {
    for (const s of AGENT_STATUSES) expect(BRAND_STATUSES).toContain(s);
  });

  it("valuationToken + eur format correctly", () => {
    expect(valuationToken("High")).toContain("heat-high");
    expect(valuationToken(null)).toContain("ink-faint");
    expect(eur(31333)).toBe("€31,333");
  });
});
