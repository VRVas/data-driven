import { describe, it, expect } from "vitest";
import dataset from "@/data/dataset.json";
import dq from "@/data/data-quality.json";
import type { Dataset } from "@/lib/types";

const ds = dataset as unknown as Dataset;

describe("ETL dataset integrity", () => {
  it("has the expected entity counts", () => {
    expect(ds.brands).toHaveLength(64);
    expect(ds.brands.filter((b) => b.scored && b.scores)).toHaveLength(45);
    expect(ds.agents).toHaveLength(13);
    expect(ds.industries).toHaveLength(7);
  });

  it("meta.counts agrees with the arrays", () => {
    expect(ds.meta.counts.brands).toBe(ds.brands.length);
    expect(ds.meta.counts.scored).toBe(ds.brands.filter((b) => b.scored).length);
    expect(ds.meta.counts.agents).toBe(ds.agents.length);
  });

  it("every brand has a unique id and a name", () => {
    const ids = ds.brands.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ds.brands.every((b) => b.name.length > 0)).toBe(true);
  });

  it("scored brands carry numeric efficiency + access aggregates", () => {
    for (const b of ds.brands.filter((x) => x.scored)) {
      expect(typeof b.scores!.economicalEfficiency).toBe("number");
      expect(typeof b.scores!.easeOfAccess).toBe("number");
    }
  });

  it("industry valuations are within the allowed set (Tech high, FMCG low)", () => {
    for (const ind of ds.industries) {
      expect(["High", "Medium", "Low"]).toContain(ind.valuation);
    }
    const byName = Object.fromEntries(ds.industries.map((i) => [i.name, i]));
    expect(byName["Tech/Telecom"].valuation).toBe("High");
    expect(byName["FMCG"].valuation).toBe("Low");
  });

  it("approached market never exceeds 100%", () => {
    for (const ind of ds.industries) {
      if (ind.approachedMarket != null) expect(ind.approachedMarket).toBeLessThanOrEqual(1);
    }
  });

  it("captured the data-quality issues from migration", () => {
    expect(dq.count).toBe(dq.issues.length);
    expect(dq.count).toBeGreaterThanOrEqual(14);
  });
});
