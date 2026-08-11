import "server-only";
import { cache } from "react";
import { getBrands } from "@/lib/data";
import { getCrmOverlayStore, type CompanyLink } from "@/lib/store/crm";
import { ownerIdResolver } from "./owners";
import { migrateBrands } from "./migrate";
import { rollupFor, awaitingDecisionValue, proposalWinRate } from "./logic";
import { winProbability } from "@/lib/scoring";
import type { BrandStatus } from "@/lib/types";
import type { Company, Deal, DealStage, Proposal } from "./types";

const prob = (stage: DealStage) => winProbability(stage as BrandStatus);

export interface CrmGraph {
  companies: Company[];
  deals: Deal[];
  proposals: Proposal[];
  links: CompanyLink[];
}

/**
 * Build the company/deal/proposal view of the live pipeline.
 *
 * Companies and deals are projected from the brand store on every read, so they
 * cannot fall out of step with lead edits. Human decisions (which deals share a
 * company) and genuinely new records (proposals) come from the overlay and are
 * applied on top.
 */
export const getCrmGraph = cache(async (): Promise<CrmGraph> => {
  const brands = await getBrands();
  const overlay = await getCrmOverlayStore().read();
  const resolveOwner = await ownerIdResolver();
  const base = migrateBrands(brands, prob);

  const linkByDeal = new Map(overlay.links.map((l) => [l.dealId, l]));
  const companyById = new Map(base.companies.map((c) => [c.id, c]));

  // Re-point linked deals at their asserted company before anything is rolled up.
  const deals = base.deals.map((d) => {
    const ownerId = resolveOwner(d.owner);
    const link = linkByDeal.get(d.id);
    if (!link) return ownerId === d.ownerId ? d : { ...d, ownerId };
    return { ...d, ownerId, companyId: link.companyId, companyName: link.companyName };
  });

  const dealsByCompany = new Map<string, Deal[]>();
  for (const d of deals) {
    const list = dealsByCompany.get(d.companyId);
    if (list) list.push(d);
    else dealsByCompany.set(d.companyId, [d]);
  }

  const companies: Company[] = [];
  for (const [companyId, companyDeals] of dealsByCompany) {
    const seed = companyById.get(companyId);
    const link = linkByDeal.get(companyDeals[0].id);
    const first = companyDeals[0];
    // A link can point at a company whose own deal has since been deleted, so
    // fall back to the group's own details rather than dropping it.
    const identity: Company =
      seed ??
      companyById.get(first.companyId) ??
      {
        ...base.companies[0],
        id: companyId,
        companyId,
        name: link?.companyName ?? first.companyName,
        nameKey: "",
        aliases: [],
        access: {
          accessibilityRaw: null,
          accessibilityScore: null,
          receptivityScore: null,
          alignmentScore: null,
          easeOfAccess: null,
        },
      };
    companies.push({
      ...identity,
      id: companyId,
      companyId,
      name: seed?.name ?? link?.companyName ?? first.companyName,
      rollup: rollupFor(companyDeals, prob),
    });
  }

  companies.sort((a, b) => a.name.localeCompare(b.name));
  return { companies, deals, proposals: overlay.proposals, links: overlay.links };
});

export interface CompanyDetail {
  company: Company;
  deals: Deal[];
  proposals: Proposal[];
}

export async function getCompanyDetail(companyId: string): Promise<CompanyDetail | null> {
  const graph = await getCrmGraph();
  const company = graph.companies.find((c) => c.id === companyId);
  if (!company) return null;
  const deals = graph.deals.filter((d) => d.companyId === companyId);
  const dealIds = new Set(deals.map((d) => d.id));
  return { company, deals, proposals: graph.proposals.filter((p) => dealIds.has(p.dealId)) };
}

/** The deal a lead id refers to, plus the company it now belongs to. */
export async function getDealWithCompany(
  dealId: string,
): Promise<{ deal: Deal; company: Company; proposals: Proposal[] } | null> {
  const graph = await getCrmGraph();
  const deal = graph.deals.find((d) => d.id === dealId);
  if (!deal) return null;
  const company = graph.companies.find((c) => c.id === deal.companyId);
  if (!company) return null;
  return { deal, company, proposals: graph.proposals.filter((p) => p.dealId === dealId) };
}

export interface PipelineMoney {
  openPipeline: number;
  weightedPipeline: number;
  awaitingDecision: number;
  proposalWinRate: number | null;
  companiesWithRepeatBusiness: number;
  repeatValue: number;
}

/** Headline money figures, including the "sent and waiting" number. */
export async function getPipelineMoney(): Promise<PipelineMoney> {
  const { companies, deals, proposals } = await getCrmGraph();
  const open = deals.filter((d) => d.outcome === "open");
  const repeat = companies.filter((c) => c.rollup.repeatValue > 0);
  return {
    openPipeline: open.reduce((s, d) => s + (d.economics.budget ?? 0), 0),
    weightedPipeline: open.reduce((s, d) => s + (d.economics.budget ?? 0) * prob(d.stage), 0),
    awaitingDecision: awaitingDecisionValue(proposals),
    proposalWinRate: proposalWinRate(proposals),
    companiesWithRepeatBusiness: repeat.length,
    repeatValue: repeat.reduce((s, c) => s + c.rollup.repeatValue, 0),
  };
}
