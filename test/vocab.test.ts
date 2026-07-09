import { describe, it, expect } from "vitest";
import { BRAND_STATUSES, PRIORITIES, INDUSTRIES, AGENT_STATUSES } from "@/lib/vocab";

const unique = (a: readonly string[]) => new Set(a).size === a.length;

describe("controlled vocabularies", () => {
  it("match the workbook's dropdown lists", () => {
    expect(BRAND_STATUSES).toHaveLength(8);
    expect(PRIORITIES).toHaveLength(3);
    expect(INDUSTRIES).toHaveLength(8);
    expect(AGENT_STATUSES).toHaveLength(6);
  });

  it("contain no duplicates", () => {
    expect(unique(BRAND_STATUSES)).toBe(true);
    expect(unique(PRIORITIES)).toBe(true);
    expect(unique(INDUSTRIES)).toBe(true);
    expect(unique(AGENT_STATUSES)).toBe(true);
  });

  it("include the canonical industry set", () => {
    expect(INDUSTRIES).toContain("Finance");
    expect(INDUSTRIES).toContain("Tech/Telecom");
    expect(INDUSTRIES).toContain("Professional Services");
    expect(INDUSTRIES).not.toContain("Financial"); // normalised away
  });
});
