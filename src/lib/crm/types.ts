/**
 * CRM entities - Company → Deal → Proposal.
 *
 * The flat `Brand` record conflated three things: the company we sell to, the
 * engagement we're running, and the commercial terms of that engagement. One
 * row therefore couldn't express "we won work with Generali last year and have
 * another conversation open now", which the team had been encoding in names
 * ("Fastweb + Vodafone 2").
 *
 * Two deliberate choices shape everything here:
 *
 *  1. `Deal.id` keeps the old `Brand.id`. Every existing URL, audit row,
 *     outreach foreign key and copilot tool argument keeps working.
 *  2. Companies are never inferred from name similarity. "Allianz Bank" and
 *     "Allianz CH" are probably different clients; grouping is an explicit,
 *     audited, reversible human decision.
 */
import type { Industry, Priority, Valuation } from "../types";

export type CrmDocType = "company" | "deal" | "proposal";

export interface CrmBase {
  id: string;
  type: CrmDocType;
  /** Partition key. A company document uses its own id here. */
  companyId: string;
  schemaVersion: 2;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------

/**
 * How easy is this ORGANISATION to sell to? Accessibility, receptivity and
 * alignment describe the relationship, not any single engagement, which is why
 * `easeOfAccess` belongs here rather than on a deal.
 */
export interface CompanyAccess {
  accessibilityRaw: string | null;
  accessibilityScore: number | null;
  receptivityScore: number | null;
  alignmentScore: number | null;
  easeOfAccess: number | null;
}

/** Derived from the company's deals. Cached for lists, never authoritative. */
export interface CompanyRollup {
  openDealCount: number;
  wonDealCount: number;
  lostDealCount: number;
  openPipelineValue: number;
  weightedPipelineValue: number;
  /** Total won across every deal, ever. */
  lifetimeValue: number;
  /** Won value beyond the first deal - what the relationship earned us after landing it. */
  repeatValue: number;
  dealWinRate: number | null;
  firstWonAt: string | null;
  lastWonAt: string | null;
  lastContact: string | null;
  nextFollowUpDate: string | null;
  computedAt: string;
}

export interface Company extends CrmBase {
  type: "company";
  name: string;
  /** Normalised key used ONLY to suggest possible duplicates for human review. */
  nameKey: string;
  aliases: string[];
  industry: Industry | null;
  industryRaw: string | null;
  owner: string | null;
  country: string | null;
  notes: string | null;
  access: CompanyAccess;
  rollup: CompanyRollup;
  /** Set only by an explicit merge; old links resolve through to the survivor. */
  mergedIntoCompanyId: string | null;
}

// ---------------------------------------------------------------------------
// Deal
// ---------------------------------------------------------------------------

/** The pipeline vocabulary, minus the value that is a deal type not a stage. */
export type DealStage =
  | "Seed"
  | "Qualify lead"
  | "Shape proposal"
  | "Closed deal"
  | "Lost";

export type DealOutcome = "open" | "won" | "lost";

/**
 * `Recurring` is a pipeline status nobody can use as a stage - a company can't
 * be simultaneously "Shape proposal" on a new deal and "Recurring" from an old
 * one. As a deal type it finally does the job: repeat business per company.
 */
export type DealType = "New Business" | "Repeat" | "Recurring" | "Upsell";

/** Value, effort and recency of THIS engagement. */
export interface DealEconomics {
  budget: number | null;
  assumption: "Confirmed" | "Estimated" | null;
  budgetScore: number | null;
  customizationScore: number | null;
  tempoMonths: number | null;
  tempoScore: number | null;
  economicalEfficiency: number | null;
}

export interface Deal extends CrmBase {
  type: "deal";
  /** The old Brand.id - this is what keeps /dashboard/pipeline/{id} alive. */
  id: string;
  /** Denormalised so a pipeline row renders without a second read. */
  companyName: string;
  name: string;
  stage: DealStage;
  outcome: DealOutcome;
  dealType: DealType;
  priority: Priority | null;
  /** Display name of the owner, as imported. */
  owner: string | null;
  /** User id - what record-level `own`/`team` scopes actually match on. */
  ownerId: string | null;
  poc: string | null;
  email: string | null;
  initialContact: string | null;
  lastContact: string | null;
  /** Renamed from `followUp`, which collided with the old "Follow Up" stage. */
  followUpDate: string | null;
  closingFailed: string | null;
  notes: string | null;
  scored: boolean;
  economics: DealEconomics;
  /** Written once when the deal closes; the accepted proposal's value. */
  wonValue: number | null;
  wonAt: string | null;
  lostAt: string | null;
}

// ---------------------------------------------------------------------------
// Proposal
// ---------------------------------------------------------------------------

/**
 * A commercial proposal. Separate records (rather than a single budget field)
 * are what make "how much have we sent out awaiting a decision?" answerable,
 * and give a real win rate rather than a stage-based guess.
 */
export type ProposalStatus = "draft" | "sent" | "accepted" | "rejected" | "expired" | "withdrawn";

export interface Proposal extends CrmBase {
  type: "proposal";
  dealId: string;
  /** Increments per revision within a deal. */
  revision: number;
  value: number;
  currency: "EUR";
  status: ProposalStatus;
  sentAt: string | null;
  decidedAt: string | null;
  validUntil: string | null;
  notes: string | null;
  createdById: string | null;
  createdByName: string | null;
}

/** Awaiting a decision - the set that sums to "out for greenlight". */
export const AWAITING_DECISION: readonly ProposalStatus[] = ["sent"];

export type CrmDoc = Company | Deal | Proposal;

export type { Industry, Priority, Valuation };
