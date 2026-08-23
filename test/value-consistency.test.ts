import { describe, it, expect } from "vitest";
import { migrateBrands } from "@/lib/crm/migrate";
import { dealValue, proposalValue, rollupFor, awaitingDecisionValue } from "@/lib/crm/logic";
import { pipelineHealth } from "@/lib/pipeline/health";
import { writeBudget, writeProposalValue } from "@/lib/pipeline/budget";
import { priorityOf, confidenceFor } from "@/lib/priority";
import { weightedValue, winProbability } from "@/lib/scoring";
import { openLeads } from "@/lib/lifecycle";
import type { Brand } from "@/lib/types";
import type { Deal, Proposal } from "@/lib/crm/types";

/**
 * One deal, one value, on every surface.
 *
 * Money totals resolve a deal's value through its proposals; the score, the
 * quadrant bubble and every per-lead figure read the budget stored on the lead.
 * Those are two different reads of the same thing, so they are only equal
 * because the write path keeps them equal — which is exactly the kind of
 * agreement that rots silently.
 */

const prob = (d: Pick<Deal, "stage" | "dealType">) =>
  winProbability((d.dealType === "Recurring" ? "Recurring" : d.stage) as never);

const lead = (over: Partial<Brand>): Brand => ({
  id: "x", name: "X", aliases: [], status: "Advanced", priority: null,
  owner: null, poc: null, email: null, industry: "Finance", industryRaw: null,
  initialContact: "2026-01-01", lastContact: "2026-08-01", followUpDate: null,
  closingFailed: null, notes: null, scored: false,
  ...over,
});

const proposal = (over: Partial<Proposal>): Proposal => ({
  id: "p", type: "proposal", companyId: "c", schemaVersion: 2,
  createdAt: "2026-01-01", updatedAt: "2026-01-01",
  dealId: "x", revision: 1, value: 0, currency: "EUR", status: "sent",
  sentAt: "2026-02-01", decidedAt: null, validUntil: null, notes: null,
  createdById: null, createdByName: null,
  ...over,
});

/** What syncLeadValue does, minus the store it needs a server for. */
const mirror = (b: Brand, proposals: Proposal[]): Brand => {
  const paper = proposalValue(b.id, proposals);
  if (!paper) {
    return b.scores?.assumption === "Confirmed" ? writeBudget(b, b.scores.budget, "Estimated") : b;
  }
  return writeProposalValue(b, paper.value, paper.basis === "accepted" ? "Confirmed" : "Estimated");
};

describe("a deal is worth the same on every surface", () => {
  it("agrees once a proposal has been sent", () => {
    const sent = proposal({ value: 80_000, status: "sent" });
    const after = mirror(writeBudget(lead({}), 30_000, "Estimated"), [sent]);
    const { deals } = migrateBrands([after], prob);

    // Money side.
    expect(dealValue(deals[0], [sent]).value).toBe(80_000);
    // Score side.
    expect(after.scores!.budget).toBe(80_000);
    expect(priorityOf(after)!.adjustedBudget).toBe(80_000 * confidenceFor("Estimated"));
    expect(weightedValue(after)).toBe(80_000 * winProbability("Advanced"));
    // The opening guess survives, so the variance report still works.
    expect(after.budgetAtOpen).toBe(30_000);
  });

  it("treats an accepted offer as fact on both sides", () => {
    const accepted = proposal({ value: 52_000, status: "accepted", decidedAt: "2026-03-01" });
    const after = mirror(writeBudget(lead({}), 30_000, "Estimated"), [accepted]);

    expect(after.scores!.assumption).toBe("Confirmed");
    expect(confidenceFor(after.scores!.assumption)).toBe(1);
    expect(priorityOf(after)!.adjustedBudget).toBe(52_000);
  });

  it("stops calling a budget confirmed once the acceptance is deleted", () => {
    const accepted = proposal({ value: 52_000, status: "accepted" });
    const confirmed = mirror(lead({}), [accepted]);
    expect(confirmed.scores!.assumption).toBe("Confirmed");

    const orphaned = mirror(confirmed, []);
    // The figure is still the last thing anyone knew; the certainty is not.
    expect(orphaned.scores!.budget).toBe(52_000);
    expect(orphaned.scores!.assumption).toBe("Estimated");
  });

  it("falls back to the lead's own figure when an ask is rejected", () => {
    const rejected = proposal({ value: 60_000, status: "rejected", decidedAt: "2026-04-01" });
    const after = mirror(writeBudget(lead({}), 20_000, "Estimated"), [rejected]);
    const { deals } = migrateBrands([after], prob);

    expect(dealValue(deals[0], [rejected])).toEqual({ value: 20_000, basis: "estimate" });
    expect(after.scores!.budget).toBe(20_000);
  });
});

describe("aggregates agree with the rows they aggregate", () => {
  const brands = [
    writeBudget(lead({ id: "a", name: "A", status: "Advanced" }), 30_000, "Estimated"),
    writeBudget(lead({ id: "b", name: "B", status: "Early" }), 50_000, "Estimated"),
    writeBudget(lead({ id: "c", name: "C", status: "Deal Closed", closingFailed: "2026-05-01" }), 100_000, "Confirmed"),
    writeBudget(lead({ id: "d", name: "D", status: "Did not work out", closingFailed: "2026-07-01" }), 40_000, "Estimated"),
  ];
  const proposals = [proposal({ id: "pd", dealId: "d", value: 70_000, status: "sent" })];
  const { deals } = migrateBrands(brands, prob);

  it("sums company rollups to the same open pipeline as the global figure", () => {
    // getPipelineMoney totals every open deal; each company totals its own.
    // Splitting the book by company must not change what the book is worth.
    const global = deals
      .filter((d) => d.outcome === "open")
      .reduce((s, d) => s + dealValue(d, proposals).value, 0);

    const perCompany = deals
      .map((d) => rollupFor([d], prob, proposals).openPipelineValue)
      .reduce((s, v) => s + v, 0);

    expect(perCompany).toBe(global);
  });

  it("leaves banked money out of probability-adjusted pipeline", () => {
    // A won deal has a stage probability of 1.0, so including it quietly adds
    // revenue already earned to a figure that claims to be pipeline.
    const live = openLeads(brands).reduce((s, b) => s + weightedValue(b), 0);
    const everything = brands.reduce((s, b) => s + weightedValue(b), 0);

    expect(everything - live).toBe(100_000);
    expect(live).toBe(30_000 * winProbability("Advanced") + 50_000 * winProbability("Early"));
  });

  it("counts a proposal as awaiting a decision only while its deal is live", () => {
    // Deal D was lost with its proposal still marked sent. The negotiation is
    // over; the record is just stale.
    const openIds = new Set(deals.filter((d) => d.outcome === "open").map((d) => d.id));
    const live = proposals.filter((p) => openIds.has(p.dealId));

    expect(awaitingDecisionValue(proposals)).toBe(70_000);
    expect(awaitingDecisionValue(live)).toBe(0);
    // The pipeline page has always read it the second way; both surfaces do now.
    expect(pipelineHealth(brands, proposals).awaitingGreenlightEur).toBe(awaitingDecisionValue(live));
  });
});
