import { describe, it, expect } from "vitest";
import { hygieneFindings, hygieneSummary, STALE_DAYS } from "@/lib/pipeline/hygiene";
import type { Brand } from "@/lib/types";

const NOW = new Date("2026-08-23T12:00:00.000Z");

const lead = (over: Partial<Brand> = {}): Brand => ({
  id: over.id ?? "x",
  name: over.name ?? "X",
  aliases: [],
  status: "Early",
  priority: null,
  owner: "Ada",
  poc: null,
  email: null,
  industry: "Fashion",
  industryRaw: null,
  initialContact: "2026-01-01",
  lastContact: "2026-08-20",
  followUpDate: "2026-09-01",
  closingFailed: null,
  notes: null,
  waitingOn: "us",
  scored: true,
  ...over,
  scores: {
    tempoMonths: null,
    tempoScore: null,
    closing: null,
    process: null,
    dealsClosed: null,
    budget: 50_000,
    assumption: "Estimated",
    budgetScore: null,
    customizationScore: null,
    accessibilityRaw: null,
    accessibilityScore: null,
    receptivityScore: null,
    alignmentScore: null,
    industry: "Fashion",
    economicalEfficiency: null,
    easeOfAccess: null,
    ...over.scores,
  },
});

const checks = (b: Brand) => hygieneFindings([b], NOW).map((f) => f.check);

describe("pipeline hygiene", () => {
  it("finds nothing wrong with a complete lead", () => {
    expect(hygieneFindings([lead()], NOW)).toEqual([]);
  });

  it("treats a lead with no value as the serious case", () => {
    const found = hygieneFindings([lead({ scores: { budget: null } as Brand["scores"] })], NOW);
    const noValue = found.find((f) => f.check === "no-value")!;
    expect(noValue.severity).toBe("high");
    expect(noValue.detail).toContain("cannot be ranked");
  });

  it("flags a lead nobody owns", () => {
    expect(checks(lead({ owner: null }))).toContain("no-owner");
  });

  it("flags an open lead that can never become late", () => {
    // No follow-up date means no deadline, so it will never reach a work queue
    // however long it sits.
    expect(checks(lead({ followUpDate: null }))).toContain("no-follow-up");
  });

  it("calls a lead untriaged only when nobody has said anything at all", () => {
    expect(checks(lead({ followUpDate: null, waitingOn: null }))).toContain("untriaged");
    // A stated side is enough - a date is a separate finding.
    expect(checks(lead({ followUpDate: null, waitingOn: "them" }))).not.toContain("untriaged");
  });

  it("counts silence from the last contact, not from the import", () => {
    const quiet = new Date(NOW);
    quiet.setUTCDate(quiet.getUTCDate() - (STALE_DAYS + 5));
    const found = checks(lead({ lastContact: quiet.toISOString().slice(0, 10) }));
    expect(found).toContain("gone-quiet");
    expect(checks(lead({ lastContact: "2026-08-20" }))).not.toContain("gone-quiet");
  });

  it("does not chase a finished deal for a follow-up it does not need", () => {
    // Won and lost deals are out of the working set, so most checks are simply
    // not applicable to them.
    const done = checks(lead({ status: "Deal Closed", followUpDate: null, lastContact: null }));
    expect(done).not.toContain("no-follow-up");
    expect(done).not.toContain("gone-quiet");
    expect(done).not.toContain("untriaged");
  });

  it("flags a finished deal that still carries a follow-up", () => {
    expect(checks(lead({ status: "Deal Closed" }))).toContain("finished-with-follow-up");
  });

  it("flags dates that cannot both be true", () => {
    const found = hygieneFindings([lead({ initialContact: "2026-06-01", closingFailed: "2026-01-01" })], NOW);
    const bad = found.find((f) => f.check === "impossible-dates")!;
    expect(bad.severity).toBe("high");
  });

  it("puts the serious findings first", () => {
    const found = hygieneFindings(
      [lead({ id: "a", name: "A", followUpDate: null }), lead({ id: "b", name: "B", owner: null })],
      NOW,
    );
    expect(found[0].severity).toBe("high");
  });

  it("summarises by record as well as by finding", () => {
    // One lead with four things wrong is one problem to go and fix, not four.
    const broken = lead({ id: "b", name: "B", owner: null, industry: null, status: null, scores: { budget: null } as Brand["scores"] });
    const s = hygieneSummary(hygieneFindings([broken, lead()], NOW));
    expect(s.leadsAffected).toBe(1);
    expect(s.total).toBeGreaterThan(3);
    expect(s.high).toBeGreaterThanOrEqual(2);
    expect(s.byCheck["no-owner"]).toBe(1);
  });

  it("scales to an empty pipeline without inventing findings", () => {
    expect(hygieneFindings([], NOW)).toEqual([]);
    expect(hygieneSummary([])).toEqual({ total: 0, high: 0, leadsAffected: 0, byCheck: {} });
  });
});
