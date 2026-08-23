/**
 * Migration from the flat `Brand` record to Company → Deal → Proposal.
 *
 * Pure and idempotent so it can be tested and re-run. Two invariants:
 *  - `Deal.id === Brand.id`, so every existing URL and foreign key survives.
 *  - One company per brand. Brands that clearly belong to the same client are
 *    NOT merged here; that is a human decision, surfaced as a suggestion.
 */
import type { Brand } from "../types";
import { companyNameKey, outcomeOfStage, rollupFor, type DealProbability } from "./logic";
import { EMPTY_ROLLUP } from "./logic";
import type {
  Company,
  Deal,
  DealStage,
  DealType,
  Proposal,
} from "./types";

const STAGES = new Set<string>([
  "Still to open",
  "Early",
  "Follow Up",
  "Advanced",
  "Back to Attack",
  "Deal Closed",
  "Did not work out",
]);

/** `Recurring` was never a stage - it described repeat business. */
export function stageOf(brand: Brand): { stage: DealStage; dealType: DealType } {
  if (brand.status === "Recurring") return { stage: "Advanced", dealType: "Recurring" };
  const stage = (brand.status && STAGES.has(brand.status) ? brand.status : "Still to open") as DealStage;
  return { stage, dealType: "New Business" };
}

export function companyIdFor(brand: Brand): string {
  return `co-${brand.id}`;
}

/**
 * Sheet dates are `yyyy-MM-dd` while everything written since is a full ISO
 * stamp. Storing both in the same field makes a plain string compare order a
 * date-only value before a same-day timestamp, so widen on the way in.
 */
function asTimestamp(day: string | null, fallback: string): string {
  if (!day) return fallback;
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

/**
 * The migration deliberately produces no proposals.
 *
 * A brand's budget and outcome already live on the deal, so re-encoding them
 * as an accepted or rejected proposal would make the proposal win rate a
 * restatement of the deal win rate under a name that promises something else:
 * a figure about paperwork we actually sent. These records were never sent
 * - sentAt would be null on every one of them.
 *
 * Proposals therefore start empty and fill up as the team records real ones.
 */
export interface MigrationResult {
  companies: Company[];
  deals: Deal[];
}

export function migrateBrands(
  brands: Brand[],
  winProbability: DealProbability,
  now: Date = new Date(),
): MigrationResult {
  const iso = now.toISOString();
  const companies: Company[] = [];
  const deals: Deal[] = [];

  for (const brand of brands) {
    const companyId = companyIdFor(brand);
    const { stage, dealType } = stageOf(brand);
    const outcome = outcomeOfStage(stage);
    const s = brand.scores;

    const deal: Deal = {
      id: brand.id,
      type: "deal",
      companyId,
      schemaVersion: 2,
      createdAt: asTimestamp(brand.initialContact, iso),
      updatedAt: iso,
      companyName: brand.name,
      name: brand.name,
      stage,
      outcome,
      dealType,
      priority: brand.priority,
      owner: brand.owner,
      ownerId: null,
      poc: brand.poc,
      email: brand.email,
      initialContact: brand.initialContact,
      lastContact: brand.lastContact,
      followUpDate: brand.followUpDate,
      closingFailed: brand.closingFailed,
      notes: brand.notes,
      scored: brand.scored,
      economics: {
        budget: s?.budget ?? null,
        assumption: s?.assumption ?? null,
        budgetScore: s?.budgetScore ?? null,
        customizationScore: s?.customizationScore ?? null,
        tempoMonths: s?.tempoMonths ?? null,
        tempoScore: s?.tempoScore ?? null,
        economicalEfficiency: s?.economicalEfficiency ?? null,
      },
      wonValue: outcome === "won" ? (s?.budget ?? null) : null,
      wonAt: outcome === "won" ? brand.closingFailed : null,
      lostAt: outcome === "lost" ? brand.closingFailed : null,
    };
    deals.push(deal);

    companies.push({
      id: companyId,
      type: "company",
      companyId,
      schemaVersion: 2,
      createdAt: asTimestamp(brand.initialContact, iso),
      updatedAt: iso,
      name: brand.name,
      nameKey: companyNameKey(brand.name),
      aliases: brand.aliases ?? [],
      industry: brand.industry,
      industryRaw: brand.industryRaw,
      owner: brand.owner,
      country: null,
      notes: null,
      access: {
        accessibilityRaw: s?.accessibilityRaw ?? null,
        accessibilityScore: s?.accessibilityScore ?? null,
        receptivityScore: s?.receptivityScore ?? null,
        alignmentScore: s?.alignmentScore ?? null,
        easeOfAccess: s?.easeOfAccess ?? null,
      },
      rollup: rollupFor([deal], winProbability, [], now),
      mergedIntoCompanyId: null,
    });
  }

  return { companies, deals };
}

export { EMPTY_ROLLUP };
