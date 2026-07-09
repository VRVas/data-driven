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
  industry: Industry | null;
  industryRaw: string | null;
  initialContact: string | null;
  lastContact: string | null;
  followUp: string | null;
  closingFailed: string | null;
  notes: string | null;
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
