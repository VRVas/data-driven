import { describe, it, expect } from "vitest";
import { penetration, whitespace, opportunityScore, rankByOpportunity } from "@/lib/tam";
import type { IndustryStat } from "@/lib/types";

describe("TAM / whitespace math", () => {
  it("computes penetration and whitespace", () => {
    expect(penetration(7, 180)).toBeCloseTo(0.0389, 4);
    expect(penetration(5, 0)).toBeNull();
    expect(penetration(5, null)).toBeNull();
    expect(whitespace(7, 180)).toBe(173);
    expect(whitespace(10, null)).toBeNull();
    expect(whitespace(300, 200)).toBe(0); // never negative
  });

  it("scores high-value, low-penetration segments highest", () => {
    const tech = opportunityScore({ opened: 5, companiesEU: 220, valuation: "High" });
    const fmcgLow = opportunityScore({ opened: 4, companiesEU: 200, valuation: "Low" });
    expect(tech).toBeGreaterThan(fmcgLow);
    expect(tech).toBeCloseTo(0.977, 3);
  });

  it("ranks industries by opportunity", () => {
    const inds = [
      { name: "FMCG", opened: 4, companiesEU: 200, valuation: "Low" },
      { name: "Tech/Telecom", opened: 5, companiesEU: 220, valuation: "High" },
    ] as IndustryStat[];
    expect(rankByOpportunity(inds)[0].name).toBe("Tech/Telecom");
  });
});
