import "server-only";
import { cache } from "react";
import { getVisibleBrands } from "@/lib/leads/visible";
import { getCrmOverlayStore, type CompanyLink } from "@/lib/store/crm";
import { ownerIdResolver } from "./owners";
import { migrateBrands } from "./migrate";
import { rollupFor, awaitingDecisionValue, proposalWinRate, EMPTY_ROLLUP } from "./logic";
import { winProbability } from "@/lib/scoring";
import type { BrandStatus } from "@/lib/types";
import type { Company, Deal, DealStage, Proposal } from "./types";

const prob = (stage: DealStage) => winProbability(stage as BrandStatus);

/**
 * A company we know only by name, because the deal that described it is gone
 * or out of scope.
 *
 * Built from nothing rather than cloned from a real company: spreading one
 * carried its industry, owner, country and notes across, so the group rendered
 * an unrelated client's details as fact — on the page, and to the copilot.
 * Blank fields say "we don't know"; borrowed ones say something false.
 */
function placeholderCompany(companyId: string, name: string, from: Deal): Company {
  return {
    id: companyId,
    type: "company",
    companyId,
    schemaVersion: 2,
    createdAt: from.createdAt,
    updatedAt: from.updatedAt,
    name,
    nameKey: "",
    aliases: [],
    industry: null,
    industryRaw: null,
    owner: null,
    country: null,
    notes: null,
    access: {
      accessibilityRaw: null,
      accessibilityScore: null,
      receptivityScore: null,
      alignmentScore: null,
      easeOfAccess: null,
    },
    rollup: EMPTY_ROLLUP,
    mergedIntoCompanyId: null,
  };
}

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
  const brands = await getVisibleBrands();
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
    // A link can point at a company whose own deal has since been deleted or
    // sits outside this viewer's scope, so the group has to be describable
    // without it.
    const identity = seed ?? placeholderCompany(companyId, link?.companyName ?? first.companyName, first);
    companies.push({
      ...identity,
      id: companyId,
      companyId,
      name: seed?.name ?? link?.companyName ?? first.companyName,
      rollup: rollupFor(companyDeals, prob),
    });
  }

  companies.sort((a, b) => a.name.localeCompare(b.name));

  // Overlay records belong to a deal, so they inherit that deal's visibility.
  // Without this the money figures, the proposal_pipeline tool and the edit and
  // delete actions all still reach proposals attached to leads the viewer
  // cannot open — addressable by id, because the id is all they take.
  const visibleDeals = new Set(deals.map((d) => d.id));
  return {
    companies,
    deals,
    proposals: overlay.proposals.filter((p) => visibleDeals.has(p.dealId)),
    links: overlay.links.filter((l) => visibleDeals.has(l.dealId)),
  };
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
