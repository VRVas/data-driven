import { describe, it, expect } from "vitest";
import {
  allowedTransitions,
  canTransition,
  statusSideEffects,
  advanceStage,
  addDays,
  STATUS_FLOW,
  ENTRY_STATUSES,
} from "@/lib/workflow";
import { outcomeConflictOf } from "@/lib/lifecycle";
import type { Brand } from "@/lib/types";

const leadAt = (status: Brand["status"], over: Partial<Brand> = {}): Brand => ({
  id: "l", name: "L", aliases: [], status, priority: null,
  owner: null, poc: null, email: null, industry: null, industryRaw: null,
  initialContact: null, lastContact: null, followUpDate: null, closingFailed: null,
  notes: null, scored: false,
  ...over,
});

describe("advanceStage", () => {
  it("refuses a move the flow graph does not allow", () => {
    const result = advanceStage(leadAt("Still to open"), "Deal Closed", "2026-08-23");
    expect(result).toEqual({ error: "Can't move from Still to open to Deal Closed." });
  });

  it("applies the date side effects of arriving", () => {
    const next = advanceStage(leadAt("Advanced"), "Deal Closed", "2026-08-23") as Brand;
    expect(next.status).toBe("Deal Closed");
    expect(next.lastContact).toBe("2026-08-23");
    expect(next.closingFailed).toBe("2026-08-23");
  });

  it("clears the stale imported outcome the move contradicts", () => {
    // The screens and the copilot both move leads. Assembling this by hand in
    // two places had already drifted: chat left this conflict flagged where the
    // UI cleared it.
    const flagged = leadAt("Advanced", {
      scored: true,
      scores: {
        tempoMonths: null, tempoScore: null, closing: null, process: "Open", dealsClosed: null,
        budget: null, assumption: null, budgetScore: null, customizationScore: null,
        accessibilityRaw: null, accessibilityScore: null, receptivityScore: null,
        alignmentScore: null, industry: "Other", economicalEfficiency: null, easeOfAccess: null,
      },
    });
    const next = advanceStage(flagged, "Deal Closed", "2026-08-23") as Brand;
    expect(next.scores!.process).toBe("Closed");
    expect(outcomeConflictOf(next)).toBeNull();
  });
});

describe("workflow transitions", () => {
  it("offers entry statuses when there is no current status", () => {
    expect(allowedTransitions(null)).toEqual(ENTRY_STATUSES);
  });

  it("only allows edges defined in the flow graph", () => {
    expect(canTransition("Advanced", "Deal Closed")).toBe(true);
    expect(canTransition("Advanced", "Recurring")).toBe(false);
    expect(canTransition("Still to open", "Deal Closed")).toBe(false);
  });

  it("has no dangling edges (every target is a known status)", () => {
    const known = new Set(Object.keys(STATUS_FLOW));
    for (const targets of Object.values(STATUS_FLOW)) {
      for (const t of targets) expect(known.has(t)).toBe(true);
    }
  });
});

describe("status side effects", () => {
  const clean = { followUpDate: null, closingFailed: null };

  it("stamps lastContact on any move", () => {
    expect(statusSideEffects(clean, "Early", "2026-07-10").lastContact).toBe("2026-07-10");
  });

  it("stamps closingFailed when closing or losing, only if empty", () => {
    expect(statusSideEffects(clean, "Deal Closed", "2026-07-10").closingFailed).toBe("2026-07-10");
    expect(
      statusSideEffects({ followUpDate: null, closingFailed: "2026-01-01" }, "Did not work out", "2026-07-10").closingFailed,
    ).toBe("2026-01-01");
  });

  it("seeds a follow-up a week out when entering Follow Up without one", () => {
    expect(statusSideEffects(clean, "Follow Up", "2026-07-10").followUpDate).toBe("2026-07-17");
    expect(statusSideEffects({ followUpDate: "2026-08-01", closingFailed: null }, "Follow Up", "2026-07-10").followUpDate).toBeUndefined();
  });
});

describe("addDays", () => {
  it("crosses month boundaries", () => {
    expect(addDays("2026-07-28", 7)).toBe("2026-08-04");
  });
});
