// Domain model for the Business-Development platform.
// Mirrors the normalized output of scripts/etl.py (src/data/dataset.json).

export type Industry =
  | "Finance"
  | "FMCG"
  | "Fashion"
  | "Tech/Telecom"
  | "Automotive"
  | "Fair"
  | "Professional Services"
  | "Other";

export type Priority = "Hot Lead" | "Warm Lead" | "Cold Lead";

export type BrandStatus =
  | "Deal Closed"
  | "Advanced"
  | "Follow Up"
  | "Early"
  | "Recurring"
  | "Back to Attack"
  | "Did not work out"
  | "Still to open";

export type Valuation = "High" | "Medium" | "Low";

/**
 * Who owes the next move on a lead.
 *
 * The two questions the pipeline view has to answer are "are we late replying
 * to them?" and "are we late chasing them?" — the same overdue date means
 * opposite things depending on which side the ball is on, so it has to be
 * recorded rather than guessed.
 */
export type WaitingOn = "us" | "them";

export interface BrandScores {
  tempoMonths: number | null;
  tempoScore: number | null;
  closing: string | null;
  process: "Open" | "Failed" | "Closed" | null;
  dealsClosed: number | null;
  budget: number | null;
  assumption: "Confirmed" | "Estimated" | null;
  budgetScore: number | null;
  customizationScore: number | null;
  accessibilityRaw: string | null;
  accessibilityScore: number | null;
  receptivityScore: number | null;
  alignmentScore: number | null;
  industry: Industry;
  economicalEfficiency: number | null;
  easeOfAccess: number | null;
}

export interface Brand {
  id: string;
  name: string;
  aliases: string[];
  status: BrandStatus | null;
  priority: Priority | null;
  owner: string | null;
  poc: string | null;
  email: string | null;
  industry: Industry | null;
  industryRaw: string | null;
  initialContact: string | null;
  lastContact: string | null;
  followUpDate: string | null;
  closingFailed: string | null;
  notes: string | null;
  /** Optional: records written before the field existed simply have no answer. */
  waitingOn?: WaitingOn | null;
  /** The next move in the team's own words — "send revised quote", "chase legal". */
  nextStep?: string | null;
  /** Months the deal is expected to take, estimated when it opened. */
  expectedMonths?: number | null;
  /** The budget we guessed before an offer was accepted, kept for comparison. */
  budgetAtOpen?: number | null;
  /** 0–3: worth beyond the invoice. Capped in the score so it cannot outrank paid work alone. */
  strategicValue?: number | null;
  /** Chosen from a fixed list, so "strategic" has to mean something specific. */
  strategicReason?: string | null;
  scored: boolean;
  scores?: BrandScores;
}

export interface IndustryStat {
  name: Industry;
  opened: number;
  companiesEU: number | null;
  approachedMarket: number | null;
  economicalEfficiency: number | null;
  easeOfAccess: number | null;
  avgBudget: number | null;
  musicVideoFit: number | null;
  valuation: Valuation | null;
}

export interface PlaybookEntry {
  industry: Industry;
  marketingNeed: string | null;
  productNeed: string | null;
  staffNeed: string | null;
  valueProposition: string | null;
  resistance: string | null;
}

export interface PlaybookTier {
  tier: "High" | "Medium" | "Resistant" | "To open";
  research: string | null;
  productExp: string | null;
  salesProcess: string | null;
  focus: number | string | null;
}

export interface MarketSizing {
  sector: string;
  companies: number | null;
  marketSizeUsdBn: number | null;
}

export interface Agent {
  id: string;
  name: string;
  status: string | null;
  priority: Priority | null;
  owner: string | null;
  poc: string | null;
  initialContact: string | null;
  lastContact: string | null;
  followUp: string | null;
  notes: string | null;
}

export interface Dataset {
  meta: {
    source: string;
    snapshotDate: string;
    generatedBy: string;
    company: string;
    owners: string[];
    industries: Industry[];
    counts: { brands: number; scored: number; agents: number; industries: number };
  };
  brands: Brand[];
  industries: IndustryStat[];
  playbook: PlaybookEntry[];
  playbookByTier: PlaybookTier[];
  marketSizing: MarketSizing[];
  agents: Agent[];
}

export interface DataQualityIssue {
  entity: string;
  key: string;
  issue: string;
  fix: string;
}
