/**
 * Migration from the flat `Brand` record to Company → Deal → Proposal.
 *
 * Pure and idempotent so it can be tested and re-run. Two invariants:
 *  - `Deal.id === Brand.id`, so every existing URL and foreign key survives.
 *  - One company per brand. Brands that clearly belong to the same client are
 *    NOT merged here; that is a human decision, surfaced as a suggestion.
 */
import type { Brand } from "../types";
import { companyNameKey, outcomeOfStage, rollupFor } from "./logic";
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

/** `Recurring` was never a stage — it described repeat business. */
export function stageOf(brand: Brand): { stage: DealStage; dealType: DealType } {
  if (brand.status === "Recurring") return { stage: "Advanced", dealType: "Recurring" };
  const stage = (brand.status && STAGES.has(brand.status) ? brand.status : "Still to open") as DealStage;
  return { stage, dealType: "New Business" };
}

export function companyIdFor(brand: Brand): string {
  return `co-${brand.id}`;
}

export interface MigrationResult {
  companies: Company[];
  deals: Deal[];
  proposals: Proposal[];
  /** Companies sharing a normalised name — for human review, never auto-merged. */
  suggestedGroups: string[][];
}

export function migrateBrands(
  brands: Brand[],
  winProbability: (stage: DealStage) => number,
  now: Date = new Date(),
): MigrationResult {
  const iso = now.toISOString();
  const companies: Company[] = [];
  const deals: Deal[] = [];
  const proposals: Proposal[] = [];

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
      createdAt: brand.initialContact ?? iso,
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
      followUpDate: brand.followUp,
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
      createdAt: brand.initialContact ?? iso,
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
      rollup: rollupFor([deal], winProbability, now),
      mergedIntoCompanyId: null,
    });

    // A scored brand carried commercial terms — that was a proposal in all but
    // name. Unscored brands have nothing to record yet.
    if (brand.scored && s?.budget != null) {
      proposals.push({
        id: `pr-${brand.id}-1`,
        type: "proposal",
        companyId,
        schemaVersion: 2,
        createdAt: brand.initialContact ?? iso,
        updatedAt: iso,
        dealId: brand.id,
        revision: 1,
        value: s.budget,
        currency: "EUR",
        status: outcome === "won" ? "accepted" : outcome === "lost" ? "rejected" : "draft",
        sentAt: null,
        decidedAt: outcome === "open" ? null : brand.closingFailed,
        validUntil: null,
        notes: s.assumption === "Estimated" ? "Imported as an estimate, not a sent proposal." : null,
        createdById: null,
        createdByName: null,
      });
    }
  }

  const byKey = new Map<string, string[]>();
  for (const c of companies) {
    const bucket = byKey.get(c.nameKey);
    if (bucket) bucket.push(c.id);
    else byKey.set(c.nameKey, [c.id]);
  }

  return {
    companies,
    deals,
    proposals,
    suggestedGroups: [...byKey.values()].filter((ids) => ids.length > 1),
  };
}

export { EMPTY_ROLLUP };
