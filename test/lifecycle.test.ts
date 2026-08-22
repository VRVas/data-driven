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
    expect(outcomeOf("Deal Closed")).toBe("won");
    expect(outcomeOf("Did not work out")).toBe("lost");
  });

  it("treats every other status — including Recurring — as open", () => {
    const terminal = new Set(["Deal Closed", "Did not work out"]);
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
      brand("Early", null, "Early co", "a"),
      brand("Deal Closed", null, "Won co", "b"),
      brand("Did not work out", null, "Lost co", "c"),
      brand("Recurring", null, "Recurring co", "d"),
    ];
    expect(openLeads(all).map((b) => b.id)).toEqual(["a", "d"]);
    expect(isOpen(all[1])).toBe(false);
  });
});

describe("outcomeConflictOf", () => {
  it("flags a won status carrying an open process", () => {
    const c = outcomeConflictOf(brand("Deal Closed", { process: "Open" }));
    expect(c).toMatchObject({ status: "Deal Closed", process: "Open", outcome: "won" });
  });

  it("flags an open status carrying a closed or failed process", () => {
    expect(outcomeConflictOf(brand("Back to Attack", { process: "Closed" }))).not.toBeNull();
    expect(outcomeConflictOf(brand("Early", { process: "Failed" }))).not.toBeNull();
  });

  it("stays quiet when the two signals agree", () => {
    expect(outcomeConflictOf(brand("Early", { process: "Open" }))).toBeNull();
    expect(outcomeConflictOf(brand("Deal Closed", { process: "Closed" }))).toBeNull();
    expect(outcomeConflictOf(brand("Did not work out", { process: "Failed" }))).toBeNull();
  });

  it("stays quiet when there is nothing to compare against", () => {
    expect(outcomeConflictOf(brand("Early", { process: null }))).toBeNull();
    expect(outcomeConflictOf(brand("Early", null))).toBeNull();
  });

  it("collects conflicts alphabetically", () => {
    const rows = outcomeConflicts([
      brand("Deal Closed", { process: "Open" }, "Zeta", "z"),
      brand("Early", { process: "Open" }, "Fine", "f"),
      brand("Early", { process: "Failed" }, "Alpha", "a"),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("reconcileImportedOutcome", () => {
  it("clears a conflict the user had no way to resolve", () => {
    // Reported: a lead correctly marked "Did not work out", with a closing
    // date, kept being flagged against an imported "Open" that has no UI.
    const flagged = brand("Did not work out", { process: "Open" });
    expect(outcomeConflictOf(flagged)).not.toBeNull();

    const after = reconcileImportedOutcome(flagged);
    expect(after.scores!.process).toBe("Failed");
    expect(outcomeConflictOf(after)).toBeNull();
  });

  it("maps a win to the sheet's own word for it", () => {
    expect(reconcileImportedOutcome(brand("Deal Closed", { process: "Open" })).scores!.process).toBe("Closed");
  });

  it("reopens the imported outcome when the lead goes back to work", () => {
    expect(reconcileImportedOutcome(brand("Back to Attack", { process: "Closed" })).scores!.process).toBe("Open");
  });

  it("leaves an agreeing record untouched", () => {
    const agreed = brand("Early", { process: "Open" });
    expect(reconcileImportedOutcome(agreed)).toBe(agreed);
  });

  it("has nothing to reconcile when the import said nothing", () => {
    const noProcess = brand("Early", { process: null });
    expect(reconcileImportedOutcome(noProcess)).toBe(noProcess);
    const unscored = brand("Early", null);
    expect(reconcileImportedOutcome(unscored)).toBe(unscored);
  });
});
