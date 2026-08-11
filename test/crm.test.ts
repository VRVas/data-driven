import { describe, it, expect } from "vitest";
import {
  companyNameKey,
  duplicateCandidates,
  outcomeOfStage,
  openDeals,
  awaitingDecisionValue,
  proposalWinRate,
  rollupFor,
  latestProposal,
} from "@/lib/crm/logic";
import { migrateBrands, stageOf, companyIdFor } from "@/lib/crm/migrate";
import { winProbability } from "@/lib/scoring";
import type { Company, Deal, Proposal, DealStage } from "@/lib/crm/types";
import type { Brand } from "@/lib/types";
import dataset from "@/data/dataset.json";

const prob = (stage: DealStage) => winProbability(stage as never);

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
  it("groups exact key matches only, and skips merged companies", () => {
    const c = (id: string, name: string, merged: string | null = null) =>
      ({ id, name, nameKey: companyNameKey(name), mergedIntoCompanyId: merged } as Company);
    const groups = duplicateCandidates([
      c("1", "Reply"), c("2", "Reply Ltd"), c("3", "Alibaba"), c("4", "Reply", "1"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((x) => x.id).sort()).toEqual(["1", "2"]);
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

  it("derives a win rate from decided proposals only", () => {
    expect(proposalWinRate([])).toBeNull();
    expect(proposalWinRate([proposal({ status: "sent" })])).toBeNull();
    expect(
      proposalWinRate([
        proposal({ status: "accepted" }), proposal({ status: "rejected" }),
        proposal({ status: "sent" }), proposal({ status: "expired" }),
      ]),
    ).toBe(0.5);
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
    expect(r.weightedPipelineValue).toBeCloseTo(30_000 * prob("Advanced"));
    expect(r.winRate).toBeCloseTo(2 / 3);
    expect(r.firstWonAt).toBe("2026-01-10");
  });

  it("reports no win rate rather than zero when nothing has closed", () => {
    expect(rollupFor([deal()], prob).winRate).toBeNull();
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

  it("creates a proposal only where commercial terms existed", () => {
    const scoredWithBudget = brands.filter((b) => b.scored && b.scores?.budget != null).length;
    expect(result.proposals).toHaveLength(scoredWithBudget);
    for (const p of result.proposals) expect(p.value).toBeGreaterThanOrEqual(0);
  });

  it("suggests the known same-client groups without merging them", () => {
    // Generali - Taverna / Generali Bank are the real case; they stay separate
    // companies until someone says otherwise.
    expect(result.companies).toHaveLength(brands.length);
    expect(Array.isArray(result.suggestedGroups)).toBe(true);
  });

  it("is idempotent — re-running yields identical ids", () => {
    const again = migrateBrands(brands, prob);
    expect(again.deals.map((d) => d.id)).toEqual(result.deals.map((d) => d.id));
    expect(again.companies.map((c) => c.id)).toEqual(result.companies.map((c) => c.id));
    expect(again.proposals.map((p) => p.id)).toEqual(result.proposals.map((p) => p.id));
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
