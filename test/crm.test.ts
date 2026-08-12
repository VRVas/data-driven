import { describe, it, expect } from "vitest";
import {
  companyNameKey,
  duplicateCandidates,
  outcomeOfStage,
  openDeals,
  awaitingDecisionValue,
  proposalWinRate,
  currentProposals,
  rollupFor,
  latestProposal,
} from "@/lib/crm/logic";
import { migrateBrands, stageOf, companyIdFor } from "@/lib/crm/migrate";
import { winProbability } from "@/lib/scoring";
import type { Company, Deal, Proposal, DealStage } from "@/lib/crm/types";
import type { Brand } from "@/lib/types";
import dataset from "@/data/dataset.json";

// Mirrors src/lib/crm/graph.ts, so the tests weight deals the way the app does.
const prob = (d: Pick<Deal, "stage" | "dealType">) =>
  winProbability((d.dealType === "Recurring" ? "Recurring" : d.stage) as never);

const deal = (over: Partial<Deal> = {}): Deal => ({
  id: "d", type: "deal", companyId: "c", schemaVersion: 2,
  createdAt: "2026-01-01", updatedAt: "2026-01-01",
  companyName: "C", name: "C", stage: "Early", outcome: "open", dealType: "New Business",
  priority: null, owner: null, ownerId: null, poc: null, email: null,
  initialContact: null, lastContact: null, followUpDate: null, closingFailed: null,
  notes: null, scored: false,
  economics: { budget: null, assumption: null, budgetScore: null, customizationScore: null, tempoMonths: null, tempoScore: null, economicalEfficiency: null },
  wonValue: null, wonAt: null, lostAt: null,
  ...over,
});

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: "p", type: "proposal", companyId: "c", schemaVersion: 2,
  createdAt: "2026-01-01", updatedAt: "2026-01-01",
  dealId: "d", revision: 1, value: 1000, currency: "EUR", status: "sent",
  sentAt: null, decidedAt: null, validUntil: null, notes: null,
  createdById: null, createdByName: null,
  ...over,
});

describe("companyNameKey", () => {
  it("normalises punctuation, accents and legal suffixes", () => {
    expect(companyNameKey("Générali S.p.A.")).toBe("generali");
    expect(companyNameKey("DELL EMEA")).toBe("dell emea");
    expect(companyNameKey("  Reply   Ltd ")).toBe("reply");
  });

  it("keeps genuinely different clients apart", () => {
    // The whole point: these must NOT collapse together.
    expect(companyNameKey("Qatar Airways")).not.toBe(companyNameKey("Qatar Museums"));
    expect(companyNameKey("Allianz Bank")).not.toBe(companyNameKey("Allianz CH"));
  });
});

describe("duplicateCandidates", () => {
  const c = (id: string, name: string, merged: string | null = null) =>
    ({ id, name, nameKey: companyNameKey(name), mergedIntoCompanyId: merged } as Company);

  it("surfaces the real same-client cases for review", () => {
    // These never match exactly, which is why exact-key grouping found nothing.
    const groups = duplicateCandidates([
      c("1", "Generali - Taverna"), c("2", "Generali Bank"), c("3", "Alibaba"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((x) => x.id).sort()).toEqual(["1", "2"]);
  });

  it("casts wide enough to catch pairs that are probably NOT the same client", () => {
    // Deliberate: the grouping only asks the question, a human answers it.
    expect(duplicateCandidates([c("1", "Qatar Airways"), c("2", "Qatar Museums")])).toHaveLength(1);
    // They still remain distinct companies — nothing is merged.
    expect(companyNameKey("Qatar Airways")).not.toBe(companyNameKey("Qatar Museums"));
  });

  it("ignores companies already merged away", () => {
    expect(duplicateCandidates([c("1", "Reply"), c("2", "Reply Ltd", "1")])).toHaveLength(0);
  });
});

describe("deal lifecycle", () => {
  it("treats only the two terminal stages as finished", () => {
    expect(outcomeOfStage("Deal Closed")).toBe("won");
    expect(outcomeOfStage("Did not work out")).toBe("lost");
    expect(outcomeOfStage("Back to Attack")).toBe("open");
    expect(openDeals([deal({ outcome: "open" }), deal({ outcome: "won" })])).toHaveLength(1);
  });
});

describe("proposals", () => {
  it("sums only the newest sent revision per deal", () => {
    const value = awaitingDecisionValue([
      proposal({ dealId: "a", revision: 1, value: 10_000 }),
      proposal({ dealId: "a", revision: 2, value: 12_000 }),
      proposal({ dealId: "b", revision: 1, value: 5_000 }),
      proposal({ dealId: "c", revision: 1, value: 99_000, status: "accepted" }),
    ]);
    expect(value).toBe(17_000);
  });

  it("drops a deal once its newest revision stops awaiting an answer", () => {
    // Quoted, re-quoted, then turned down. Reading the newest *sent* revision
    // instead of the newest revision leaves the superseded €10k sitting in the
    // total for a deal that is already dead.
    const requotedThenRejected = [
      proposal({ dealId: "a", revision: 1, value: 10_000, status: "sent" }),
      proposal({ dealId: "a", revision: 2, value: 12_000, status: "rejected" }),
    ];
    expect(awaitingDecisionValue(requotedThenRejected)).toBe(0);
  });

  it("counts one live revision per deal", () => {
    expect(
      currentProposals([
        proposal({ id: "p1", dealId: "a", revision: 1 }),
        proposal({ id: "p2", dealId: "a", revision: 2 }),
        proposal({ id: "p3", dealId: "b", revision: 1 }),
      ]).map((p) => p.id).sort(),
    ).toEqual(["p2", "p3"]);
  });

  it("derives a win rate from decided proposals only", () => {
    expect(proposalWinRate([])).toBeNull();
    expect(proposalWinRate([proposal({ status: "sent" })])).toBeNull();
    expect(
      proposalWinRate([
        proposal({ id: "p1", dealId: "a", status: "accepted" }),
        proposal({ id: "p2", dealId: "b", status: "rejected" }),
        proposal({ id: "p3", dealId: "c", status: "sent" }),
        proposal({ id: "p4", dealId: "d", status: "expired" }),
      ]),
    ).toBe(0.5);
  });

  it("scores a re-quoted deal once, by its most recent decision", () => {
    // Haggled down twice and finally won. Counting revisions instead of deals
    // reports one win against two losses for a deal we did not lose.
    const oneDealWonAfterTwoRounds = [
      proposal({ id: "p1", dealId: "a", revision: 1, status: "rejected" }),
      proposal({ id: "p2", dealId: "a", revision: 2, status: "rejected" }),
      proposal({ id: "p3", dealId: "a", revision: 3, status: "accepted" }),
    ];
    expect(proposalWinRate(oneDealWonAfterTwoRounds)).toBe(1);
  });

  it("takes the highest revision as current", () => {
    expect(latestProposal([proposal({ revision: 1 }), proposal({ revision: 3 }), proposal({ revision: 2 })])!.revision).toBe(3);
  });
});

describe("rollupFor", () => {
  it("separates landing a client from what the relationship earned after", () => {
    const r = rollupFor(
      [
        deal({ id: "1", outcome: "won", stage: "Deal Closed", wonValue: 40_000, wonAt: "2026-01-10" }),
        deal({ id: "2", outcome: "won", stage: "Deal Closed", wonValue: 25_000, wonAt: "2026-06-01" }),
        deal({ id: "3", outcome: "open", stage: "Advanced", economics: { ...deal().economics, budget: 30_000 } }),
        deal({ id: "4", outcome: "lost", stage: "Did not work out" }),
      ],
      prob,
    );
    expect(r.lifetimeValue).toBe(65_000);
    expect(r.repeatValue).toBe(25_000); // everything after the first win
    expect(r.openPipelineValue).toBe(30_000);
    expect(r.weightedPipelineValue).toBeCloseTo(30_000 * prob({ stage: "Advanced", dealType: "New Business" }));
    expect(r.dealWinRate).toBeCloseTo(2 / 3);
    expect(r.firstWonAt).toBe("2026-01-10");
  });

  it("weights recurring work the same as the lead pages do", () => {
    // Recurring moved off the stage axis onto the deal type, so the deal now
    // sits at "Advanced". Weighting by stage alone valued it at 0.6 here while
    // the lead pages still used winProbability("Recurring") = 0.85.
    const recurring = rollupFor(
      [deal({ stage: "Advanced", dealType: "Recurring", economics: { ...deal().economics, budget: 100_000 } })],
      prob,
    );
    expect(recurring.weightedPipelineValue).toBeCloseTo(100_000 * winProbability("Recurring"));

    const newBusiness = rollupFor(
      [deal({ stage: "Advanced", dealType: "New Business", economics: { ...deal().economics, budget: 100_000 } })],
      prob,
    );
    expect(newBusiness.weightedPipelineValue).toBeCloseTo(100_000 * winProbability("Advanced"));
  });

  it("reports no win rate rather than zero when nothing has closed", () => {    expect(rollupFor([deal()], prob).dealWinRate).toBeNull();
  });

  it("picks the same first win regardless of order when wins are undated", () => {
    const a = deal({ id: "a", outcome: "won", stage: "Deal Closed", wonValue: 10_000, wonAt: null });
    const b = deal({ id: "b", outcome: "won", stage: "Deal Closed", wonValue: 40_000, wonAt: null });
    // Repeat value must not depend on the order deals happened to arrive in.
    expect(rollupFor([a, b], prob).repeatValue).toBe(rollupFor([b, a], prob).repeatValue);
    expect(rollupFor([a, b], prob).repeatValue).toBe(40_000);
  });
});

describe("migrateBrands against the real dataset", () => {
  const brands = dataset.brands as unknown as Brand[];
  const result = migrateBrands(brands, prob);

  it("produces one deal per brand and preserves every id", () => {
    expect(result.deals).toHaveLength(brands.length);
    const dealIds = new Set(result.deals.map((d) => d.id));
    for (const b of brands) expect(dealIds.has(b.id), `${b.id} must survive`).toBe(true);
  });

  it("keeps /dashboard/pipeline/alibaba resolvable", () => {
    expect(result.deals.find((d) => d.id === "alibaba")).toBeTruthy();
  });

  it("moves Recurring off the stage axis and onto the deal type", () => {
    expect(result.deals.every((d) => (d.stage as string) !== "Recurring")).toBe(true);
    expect(stageOf({ status: "Recurring" } as Brand)).toEqual({ stage: "Advanced", dealType: "Recurring" });
  });

  it("keeps every deal attached to a real company", () => {
    const ids = new Set(result.companies.map((c) => c.id));
    for (const d of result.deals) expect(ids.has(d.companyId)).toBe(true);
    expect(companyIdFor({ id: "alibaba" } as Brand)).toBe("co-alibaba");
  });

  it("records no proposals, because the sheet never held one", () => {
    // Budget and outcome already live on the deal. Re-encoding them as an
    // accepted or rejected proposal would make the proposal win rate a
    // restatement of the deal win rate wearing a different name.
    expect("proposals" in result).toBe(false);
  });

  it("leaves same-client companies separate for a human to merge", () => {
    // Generali - Taverna / Generali Bank are the real case: one company per
    // brand, and duplicateCandidates surfaces the pair as a suggestion.
    expect(result.companies).toHaveLength(brands.length);
    const generali = duplicateCandidates(result.companies).find((group) =>
      group.every((c) => c.name.toLowerCase().startsWith("generali")),
    );
    expect(generali?.length ?? 0).toBeGreaterThan(1);
  });

  it("is idempotent — re-running at the same instant yields identical records", () => {
    // Time has to be pinned for the claim to mean anything: updatedAt and
    // computedAt are stamped from `now`, so the previous version of this test
    // compared ids only and would have passed even if every other field had
    // changed.
    const at = new Date("2026-08-11T09:00:00.000Z");
    expect(migrateBrands(brands, prob, at)).toEqual(migrateBrands(brands, prob, at));
  });

  it("carries the scoring split to the right side of the seam", () => {
    const alibabaDeal = result.deals.find((d) => d.id === "alibaba")!;
    const alibabaCo = result.companies.find((c) => c.id === "co-alibaba")!;
    // Money and effort belong to the engagement.
    expect(alibabaDeal.economics.budget).toBe(40_000);
    // Reachability belongs to the organisation.
    expect(alibabaCo.access.easeOfAccess).toBeCloseTo(4.6667, 3);
  });
});

describe("timestamp normalisation", () => {
  const at = new Date("2026-08-11T09:00:00.000Z");
  const lead = (over: Partial<Brand>): Brand => ({
    id: "x", name: "X", aliases: [], scored: false, status: null, priority: null,
    owner: null, poc: null, email: null, industry: null, industryRaw: null,
    initialContact: null, lastContact: null, followUpDate: null, closingFailed: null, notes: null,
    ...over,
  });

  it("widens sheet dates to full ISO stamps", () => {
    // Mixing "2026-06-09" with "2026-06-09T09:00:00.000Z" in one field makes a
    // string compare order the date-only value first.
    expect(migrateBrands([lead({ initialContact: "2026-06-09" })], prob, at).deals[0].createdAt).toBe(
      "2026-06-09T00:00:00.000Z",
    );
    expect(migrateBrands([lead({ initialContact: null })], prob, at).deals[0].createdAt).toBe(at.toISOString());
  });

  it("falls back rather than emitting an invalid stamp", () => {
    expect(migrateBrands([lead({ initialContact: "not-a-date" })], prob, at).deals[0].createdAt).toBe(
      at.toISOString(),
    );
  });
});
