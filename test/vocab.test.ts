import { describe, it, expect } from "vitest";
import {
  BRAND_STATUSES,
  PRIORITIES,
  INDUSTRIES,
  AGENT_STATUSES,
  LEGACY_STATUSES,
  toBrandStatus,
} from "@/lib/vocab";

const unique = (a: readonly string[]) => new Set(a).size === a.length;

describe("controlled vocabularies", () => {
  it("match the agreed stage list", () => {
    // The workbook had eight stages; the team cut them to six. Early, Follow Up
    // and Back to Attack all became Qualify lead.
    expect(BRAND_STATUSES).toHaveLength(6);
    expect(PRIORITIES).toHaveLength(3);
    expect(INDUSTRIES).toHaveLength(8);
    expect(AGENT_STATUSES).toHaveLength(4);
  });

  it("every retired stage still resolves to a current one", () => {
    // Cosmos rows are not rewritten until someone saves that lead, so a read
    // that does not translate blanks the stage on live data.
    for (const [old, now] of Object.entries(LEGACY_STATUSES)) {
      expect(BRAND_STATUSES, `${old} maps to ${now}`).toContain(now);
      expect(toBrandStatus(old)).toBe(now);
    }
    expect(toBrandStatus("Deal Closed")).toBe("Closed deal");
    expect(toBrandStatus("Did not work out")).toBe("Lost");
    // Neither vocabulary - better blank than a value the select cannot render.
    expect(toBrandStatus("Hibernating")).toBeNull();
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
