/**
 * Pure CRM logic — no I/O, so every rule here is unit-testable.
 */
import type {
  Company,
  CompanyRollup,
  Deal,
  DealOutcome,
  DealStage,
  Proposal,
  ProposalStatus,
} from "./types";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

const LEGAL_SUFFIXES =
  /\b(s\.?p\.?a|s\.?r\.?l|ltd|limited|gmbh|inc|llc|plc|sa|nv|bv|ag|co|corp|corporation|group|holding|holdings)\b/g;

/**
 * Normalised key for grouping SUGGESTIONS only.
 *
 * Never use this to merge automatically: "Allianz Bank" and "Allianz CH" share
 * a root but are probably different clients, and "Qatar Airways" / "Qatar
 * Museums" certainly are. It exists to put candidates in front of a human.
 */
export function companyNameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    // Dots and apostrophes close up rather than split, so "S.p.A." becomes a
    // single token the suffix list can actually match.
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The leading word of a company name — a deliberately loose grouping signal.
 *
 * Exact key matching is useless here: the real cases ("Generali - Taverna" and
 * "Generali Bank") never match exactly, so nothing would ever be suggested.
 * This casts a wider net on purpose and WILL pair genuinely different clients
 * (Qatar Airways / Qatar Museums). That is the intended trade — it surfaces a
 * question for a human, never an answer.
 */
export function companyRoot(name: string): string {
  return companyNameKey(name).split(" ")[0] ?? "";
}

/** Companies that might be the same client. A suggestion, never a merge. */
export function duplicateCandidates(companies: Company[]): Company[][] {
  const groups = new Map<string, Company[]>();
  for (const c of companies) {
    if (c.mergedIntoCompanyId) continue;
    const key = companyRoot(c.name);
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(c);
    else groups.set(key, [c]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .sort((a, b) => a[0].name.localeCompare(b[0].name));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const WON_STAGE: DealStage = "Deal Closed";
const LOST_STAGE: DealStage = "Did not work out";

export function outcomeOfStage(stage: DealStage | null | undefined): DealOutcome {
  if (stage === WON_STAGE) return "won";
  if (stage === LOST_STAGE) return "lost";
  return "open";
}

export const isOpenDeal = (d: Pick<Deal, "outcome">): boolean => d.outcome === "open";

export function openDeals<T extends Pick<Deal, "outcome">>(deals: T[]): T[] {
  return deals.filter(isOpenDeal);
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export function latestProposal(proposals: Proposal[]): Proposal | null {
  if (proposals.length === 0) return null;
  return [...proposals].sort((a, b) => b.revision - a.revision)[0];
}

export function proposalsWithStatus(proposals: Proposal[], status: ProposalStatus): Proposal[] {
  return proposals.filter((p) => p.status === status);
}

/**
 * Value sent to clients that nobody has answered yet — the "waiting for
 * greenlight" figure. Only the newest revision of each deal counts, so a
 * re-quoted deal isn't added twice.
 */
export function awaitingDecisionValue(proposals: Proposal[]): number {
  const newestByDeal = new Map<string, Proposal>();
  for (const p of proposals) {
    if (p.status !== "sent") continue;
    const current = newestByDeal.get(p.dealId);
    if (!current || p.revision > current.revision) newestByDeal.set(p.dealId, p);
  }
  return [...newestByDeal.values()].reduce((sum, p) => sum + p.value, 0);
}

/** Decided proposals only — an honest win rate, not a stage-based guess. */
export function proposalWinRate(proposals: Proposal[]): number | null {
  const accepted = proposals.filter((p) => p.status === "accepted").length;
  const rejected = proposals.filter((p) => p.status === "rejected").length;
  const decided = accepted + rejected;
  return decided === 0 ? null : accepted / decided;
}

// ---------------------------------------------------------------------------
// Rollups
// ---------------------------------------------------------------------------

const latest = (dates: (string | null)[]): string | null =>
  dates.filter((d): d is string => !!d).sort().at(-1) ?? null;

const earliest = (dates: (string | null)[]): string | null =>
  dates.filter((d): d is string => !!d).sort().at(0) ?? null;

/**
 * Recompute a company's totals from its deals. Cheap enough to run on read;
 * the cached copy on the document is only there to keep list views fast.
 */
export function rollupFor(
  deals: Deal[],
  winProbability: (stage: DealStage) => number,
  now: Date = new Date(),
): CompanyRollup {
  const open = deals.filter((d) => d.outcome === "open");
  const won = deals.filter((d) => d.outcome === "won");
  const lost = deals.filter((d) => d.outcome === "lost");

  const valueOf = (d: Deal) => d.economics.budget ?? 0;
  const lifetimeValue = won.reduce((s, d) => s + (d.wonValue ?? valueOf(d)), 0);
  // Undated wins would otherwise make "which came first" depend on array order,
  // and repeat value with it. Fall back to the id so the answer is stable.
  const wonInOrder = [...won].sort((a, b) =>
    (a.wonAt ?? "9999-12-31").localeCompare(b.wonAt ?? "9999-12-31") || a.id.localeCompare(b.id),
  );
  const firstWon = wonInOrder[0] ?? null;
  const decided = won.length + lost.length;

  return {
    openDealCount: open.length,
    wonDealCount: won.length,
    lostDealCount: lost.length,
    openPipelineValue: open.reduce((s, d) => s + valueOf(d), 0),
    weightedPipelineValue: open.reduce((s, d) => s + valueOf(d) * winProbability(d.stage), 0),
    lifetimeValue,
    repeatValue: lifetimeValue - (firstWon ? (firstWon.wonValue ?? valueOf(firstWon)) : 0),
    winRate: decided === 0 ? null : won.length / decided,
    firstWonAt: earliest(won.map((d) => d.wonAt)),
    lastWonAt: latest(won.map((d) => d.wonAt)),
    lastContact: latest(deals.map((d) => d.lastContact)),
    nextFollowUpDate: earliest(open.map((d) => d.followUpDate)),
    computedAt: now.toISOString(),
  };
}

export const EMPTY_ROLLUP: CompanyRollup = {
  openDealCount: 0,
  wonDealCount: 0,
  lostDealCount: 0,
  openPipelineValue: 0,
  weightedPipelineValue: 0,
  lifetimeValue: 0,
  repeatValue: 0,
  winRate: null,
  firstWonAt: null,
  lastWonAt: null,
  lastContact: null,
  nextFollowUpDate: null,
  computedAt: "1970-01-01T00:00:00.000Z",
};
