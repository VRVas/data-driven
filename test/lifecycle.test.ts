import { describe, it, expect } from "vitest";
import { outcomeOf, isOpen, openLeads, outcomeConflictOf, outcomeConflicts, reconcileImportedOutcome } from "@/lib/lifecycle";
import { BRAND_STATUSES } from "@/lib/vocab";
import type { Brand, BrandScores } from "@/lib/types";

function brand(
  status: Brand["status"],
  scores: Partial<BrandScores> | null = null,
  name = "X",
  id = "x",
): Brand {
  return {
    id, name, aliases: [], scored: scores != null, status,
    priority: null, owner: null, poc: null, email: null, industry: null, industryRaw: null,
    initialContact: null, lastContact: null, followUpDate: null, closingFailed: null, notes: null,
    scores: scores
      ? {
          tempoMonths: null, tempoScore: null, closing: null, process: null, dealsClosed: null,
          budget: null, assumption: null, budgetScore: null, customizationScore: null,
          accessibilityRaw: null, accessibilityScore: null, receptivityScore: null,
          alignmentScore: null, industry: "Finance", economicalEfficiency: null,
          easeOfAccess: null, ...scores,
        }
      : undefined,
  };
}

describe("outcomeOf", () => {
  it("treats only the two terminal statuses as finished", () => {
    expect(outcomeOf("Closed deal")).toBe("won");
    expect(outcomeOf("Lost")).toBe("lost");
  });

  it("treats every other status - including Recurring - as open", () => {
    const terminal = new Set(["Closed deal", "Lost"]);
    for (const s of BRAND_STATUSES.filter((s) => !terminal.has(s))) {
      expect(outcomeOf(s), `${s} should be open`).toBe("open");
    }
  });

  it("defaults an unset status to open", () => {
    expect(outcomeOf(null)).toBe("open");
    expect(outcomeOf(undefined)).toBe("open");
  });
});

describe("openLeads", () => {
  it("keeps live leads and drops won and lost ones", () => {
    const all = [
      brand("Qualify lead", null, "Early co", "a"),
      brand("Closed deal", null, "Won co", "b"),
      brand("Lost", null, "Lost co", "c"),
      brand("Recurring", null, "Recurring co", "d"),
    ];
    expect(openLeads(all).map((b) => b.id)).toEqual(["a", "d"]);
    expect(isOpen(all[1])).toBe(false);
  });
});

describe("outcomeConflictOf", () => {
  it("flags a won status carrying an open process", () => {
    const c = outcomeConflictOf(brand("Closed deal", { process: "Open" }));
    expect(c).toMatchObject({ status: "Closed deal", process: "Open", outcome: "won" });
  });

  it("flags an open status carrying a closed or failed process", () => {
    expect(outcomeConflictOf(brand("Qualify lead", { process: "Closed" }))).not.toBeNull();
    expect(outcomeConflictOf(brand("Qualify lead", { process: "Failed" }))).not.toBeNull();
  });

  it("stays quiet when the two signals agree", () => {
    expect(outcomeConflictOf(brand("Qualify lead", { process: "Open" }))).toBeNull();
    expect(outcomeConflictOf(brand("Closed deal", { process: "Closed" }))).toBeNull();
    expect(outcomeConflictOf(brand("Lost", { process: "Failed" }))).toBeNull();
  });

  it("stays quiet when there is nothing to compare against", () => {
    expect(outcomeConflictOf(brand("Qualify lead", { process: null }))).toBeNull();
    expect(outcomeConflictOf(brand("Qualify lead", null))).toBeNull();
  });

  it("collects conflicts alphabetically", () => {
    const rows = outcomeConflicts([
      brand("Closed deal", { process: "Open" }, "Zeta", "z"),
      brand("Qualify lead", { process: "Open" }, "Fine", "f"),
      brand("Qualify lead", { process: "Failed" }, "Alpha", "a"),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("reconcileImportedOutcome", () => {
  it("clears a conflict the user had no way to resolve", () => {
    // Reported: a lead correctly marked "Lost", with a closing
    // date, kept being flagged against an imported "Open" that has no UI.
    const flagged = brand("Lost", { process: "Open" });
    expect(outcomeConflictOf(flagged)).not.toBeNull();

    const after = reconcileImportedOutcome(flagged);
    expect(after.scores!.process).toBe("Failed");
    expect(outcomeConflictOf(after)).toBeNull();
  });

  it("maps a win to the sheet's own word for it", () => {
    expect(reconcileImportedOutcome(brand("Closed deal", { process: "Open" })).scores!.process).toBe("Closed");
  });

  it("reopens the imported outcome when the lead goes back to work", () => {
    expect(reconcileImportedOutcome(brand("Qualify lead", { process: "Closed" })).scores!.process).toBe("Open");
  });

  it("leaves an agreeing record untouched", () => {
    const agreed = brand("Qualify lead", { process: "Open" });
    expect(reconcileImportedOutcome(agreed)).toBe(agreed);
  });

  it("has nothing to reconcile when the import said nothing", () => {
    const noProcess = brand("Qualify lead", { process: null });
    expect(reconcileImportedOutcome(noProcess)).toBe(noProcess);
    const unscored = brand("Qualify lead", null);
    expect(reconcileImportedOutcome(unscored)).toBe(unscored);
  });
});
