import { describe, it, expect } from "vitest";
import { followUpsFrom, bucketFor, countDue } from "@/lib/leads/followups";
import type { Brand } from "@/lib/types";

function brand(o: Partial<Brand> = {}): Brand {
  return {
    id: "b",
    name: "Acme",
    aliases: [],
    status: "Early",
    priority: null,
    owner: null,
    poc: null,
    email: null,
    industry: null,
    industryRaw: null,
    initialContact: null,
    lastContact: null,
    followUpDate: null,
    closingFailed: null,
    notes: null,
    scored: false,
    ...o,
  };
}

const NOW = new Date("2026-07-10T12:00:00");

describe("bucketFor", () => {
  it("classifies by day delta", () => {
    expect(bucketFor(-1)).toBe("overdue");
    expect(bucketFor(0)).toBe("today");
    expect(bucketFor(5)).toBe("upcoming");
  });
});

describe("followUpsFrom", () => {
  it("keeps only open leads with a follow-up inside the horizon, soonest first", () => {
    const brands = [
      brand({ id: "a", followUpDate: "2026-07-05" }), // overdue
      brand({ id: "b", followUpDate: "2026-07-10" }), // today
      brand({ id: "c", followUpDate: "2026-07-20" }), // upcoming
      brand({ id: "d", followUpDate: "2026-09-30" }), // beyond horizon
      brand({ id: "e", followUpDate: null }), // no date
      brand({ id: "f", followUpDate: "2026-07-08", status: "Deal Closed" }), // closed
      brand({ id: "g", followUpDate: "2026-07-09", status: "Did not work out" }), // lost
    ];
    const r = followUpsFrom(brands, NOW);
    expect(r.map((x) => x.brand.id)).toEqual(["a", "b", "c"]);
    expect(r[0].bucket).toBe("overdue");
    expect(r[1].bucket).toBe("today");
  });

  it("countDue counts overdue + today only", () => {
    const brands = [
      brand({ id: "a", followUpDate: "2026-07-05" }),
      brand({ id: "b", followUpDate: "2026-07-10" }),
      brand({ id: "c", followUpDate: "2026-07-20" }),
    ];
    expect(countDue(followUpsFrom(brands, NOW))).toBe(2);
  });
});
