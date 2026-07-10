import { describe, it, expect } from "vitest";
import {
  allowedTransitions,
  canTransition,
  statusSideEffects,
  addDays,
  STATUS_FLOW,
  ENTRY_STATUSES,
} from "@/lib/workflow";

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
  const clean = { followUp: null, closingFailed: null };

  it("stamps lastContact on any move", () => {
    expect(statusSideEffects(clean, "Early", "2026-07-10").lastContact).toBe("2026-07-10");
  });

  it("stamps closingFailed when closing or losing, only if empty", () => {
    expect(statusSideEffects(clean, "Deal Closed", "2026-07-10").closingFailed).toBe("2026-07-10");
    expect(
      statusSideEffects({ followUp: null, closingFailed: "2026-01-01" }, "Did not work out", "2026-07-10").closingFailed,
    ).toBe("2026-01-01");
  });

  it("seeds a follow-up a week out when entering Follow Up without one", () => {
    expect(statusSideEffects(clean, "Follow Up", "2026-07-10").followUp).toBe("2026-07-17");
    expect(statusSideEffects({ followUp: "2026-08-01", closingFailed: null }, "Follow Up", "2026-07-10").followUp).toBeUndefined();
  });
});

describe("addDays", () => {
  it("crosses month boundaries", () => {
    expect(addDays("2026-07-28", 7)).toBe("2026-08-04");
  });
});
