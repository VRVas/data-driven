import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getCosmosDb, isCosmosConfigured } from "./cosmos";
import { getBrandStore } from "./brands";
import { migrateBrands } from "@/lib/crm/migrate";
import { winProbability } from "@/lib/scoring";
import type { Company, CrmDoc, Deal, DealStage, Proposal } from "@/lib/crm/types";
import type { BrandStatus } from "@/lib/types";

const prob = (stage: DealStage) => winProbability(stage as BrandStatus);

export interface CrmSnapshot {
  companies: Company[];
  deals: Deal[];
  proposals: Proposal[];
}

export interface CrmStore {
  snapshot(): Promise<CrmSnapshot>;
  companies(): Promise<Company[]>;
  company(id: string): Promise<Company | null>;
  saveCompany(company: Company): Promise<Company>;
  deals(): Promise<Deal[]>;
  deal(id: string): Promise<Deal | null>;
  dealsForCompany(companyId: string): Promise<Deal[]>;
  saveDeal(deal: Deal): Promise<Deal>;
  removeDeal(id: string): Promise<void>;
  proposals(): Promise<Proposal[]>;
  proposalsForDeal(dealId: string): Promise<Proposal[]>;
  saveProposal(proposal: Proposal): Promise<Proposal>;
  removeProposal(id: string, companyId: string): Promise<void>;
}

/**
 * Build the initial CRM graph from whatever the brand store currently holds —
 * not from the raw seed file, so edits made through the app carry across.
 */
async function seedFromBrands(): Promise<CrmSnapshot> {
  const brands = await getBrandStore().list();
  const { companies, deals, proposals } = migrateBrands(brands, prob);
  return { companies, deals, proposals };
}

const DATA_DIR = path.join(process.cwd(), ".data");
const CRM_FILE = path.join(DATA_DIR, "crm.json");

class LocalCrmStore implements CrmStore {
  private async readAll(): Promise<CrmSnapshot> {
    try {
      return JSON.parse(await fs.readFile(CRM_FILE, "utf8")) as CrmSnapshot;
    } catch {
      const seeded = await seedFromBrands();
      await this.writeAll(seeded);
      return seeded;
    }
  }
  private async writeAll(snapshot: CrmSnapshot): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(CRM_FILE, JSON.stringify(snapshot, null, 2), "utf8");
  }

  async snapshot() {
    return this.readAll();
  }
  async companies() {
    return (await this.readAll()).companies;
  }
  async company(id: string) {
    return (await this.companies()).find((c) => c.id === id) ?? null;
  }
  async saveCompany(company: Company) {
    const snap = await this.readAll();
    const i = snap.companies.findIndex((c) => c.id === company.id);
    if (i >= 0) snap.companies[i] = company;
    else snap.companies.push(company);
    await this.writeAll(snap);
    return company;
  }
  async deals() {
    return (await this.readAll()).deals;
  }
  async deal(id: string) {
    return (await this.deals()).find((d) => d.id === id) ?? null;
  }
  async dealsForCompany(companyId: string) {
    return (await this.deals()).filter((d) => d.companyId === companyId);
  }
  async saveDeal(deal: Deal) {
    const snap = await this.readAll();
    const i = snap.deals.findIndex((d) => d.id === deal.id);
    if (i >= 0) snap.deals[i] = deal;
    else snap.deals.push(deal);
    await this.writeAll(snap);
    return deal;
  }
  async removeDeal(id: string) {
    const snap = await this.readAll();
    snap.deals = snap.deals.filter((d) => d.id !== id);
    snap.proposals = snap.proposals.filter((p) => p.dealId !== id);
    await this.writeAll(snap);
  }
  async proposals() {
    return (await this.readAll()).proposals;
  }
  async proposalsForDeal(dealId: string) {
    return (await this.proposals()).filter((p) => p.dealId === dealId);
  }
  async saveProposal(proposal: Proposal) {
    const snap = await this.readAll();
    const i = snap.proposals.findIndex((p) => p.id === proposal.id);
    if (i >= 0) snap.proposals[i] = proposal;
    else snap.proposals.push(proposal);
    await this.writeAll(snap);
    return proposal;
  }
  async removeProposal(id: string) {
    const snap = await this.readAll();
    snap.proposals = snap.proposals.filter((p) => p.id !== id);
    await this.writeAll(snap);
  }
}

/**
 * Cosmos: one `crm` container partitioned by /companyId, so a company and all
 * of its deals and proposals share a logical partition — "everything for this
 * client" is a single-partition read, and writes across them can be batched.
 */
class CosmosCrmStore implements CrmStore {
  private static seeded = false;

  private container() {
    const db = getCosmosDb();
    if (!db) throw new Error("Cosmos DB is not configured");
    return db.container("crm");
  }

  private async all(): Promise<CrmDoc[]> {
    const c = this.container();
    const { resources } = await c.items.readAll<CrmDoc>().fetchAll();
    if (resources.length === 0 && !CosmosCrmStore.seeded) {
      CosmosCrmStore.seeded = true;
      const seed = await seedFromBrands();
      const docs: CrmDoc[] = [...seed.companies, ...seed.deals, ...seed.proposals];
      for (const doc of docs) await c.items.upsert(doc).catch(() => undefined);
      return docs;
    }
    return resources;
  }

  async snapshot(): Promise<CrmSnapshot> {
    const docs = await this.all();
    return {
      companies: docs.filter((d): d is Company => d.type === "company"),
      deals: docs.filter((d): d is Deal => d.type === "deal"),
      proposals: docs.filter((d): d is Proposal => d.type === "proposal"),
    };
  }
  async companies() {
    return (await this.snapshot()).companies;
  }
  async company(id: string) {
    return (await this.companies()).find((c) => c.id === id) ?? null;
  }
  async saveCompany(company: Company) {
    await this.container().items.upsert<Company>(company);
    return company;
  }
  async deals() {
    return (await this.snapshot()).deals;
  }
  async deal(id: string) {
    return (await this.deals()).find((d) => d.id === id) ?? null;
  }
  async dealsForCompany(companyId: string) {
    const { resources } = await this.container()
      .items.query<Deal>({
        query: "SELECT * FROM c WHERE c.companyId = @companyId AND c.type = 'deal'",
        parameters: [{ name: "@companyId", value: companyId }],
      })
      .fetchAll();
    return resources;
  }
  async saveDeal(deal: Deal) {
    await this.container().items.upsert<Deal>(deal);
    return deal;
  }
  async removeDeal(id: string) {
    const deal = await this.deal(id);
    if (!deal) return;
    const c = this.container();
    for (const p of await this.proposalsForDeal(id)) {
      await c.item(p.id, p.companyId).delete().catch(() => undefined);
    }
    await c.item(id, deal.companyId).delete().catch(() => undefined);
  }
  async proposals() {
    return (await this.snapshot()).proposals;
  }
  async proposalsForDeal(dealId: string) {
    const { resources } = await this.container()
      .items.query<Proposal>({
        query: "SELECT * FROM c WHERE c.type = 'proposal' AND c.dealId = @dealId",
        parameters: [{ name: "@dealId", value: dealId }],
      })
      .fetchAll();
    return resources;
  }
  async saveProposal(proposal: Proposal) {
    await this.container().items.upsert<Proposal>(proposal);
    return proposal;
  }
  async removeProposal(id: string, companyId: string) {
    await this.container().item(id, companyId).delete().catch(() => undefined);
  }
}

let store: CrmStore | undefined;

export function getCrmStore(): CrmStore {
  if (store) return store;
  store = isCosmosConfigured() ? new CosmosCrmStore() : new LocalCrmStore();
  return store;
}
