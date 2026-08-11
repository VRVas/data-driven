import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getCosmosDb, isCosmosConfigured } from "./cosmos";
import type { Proposal } from "@/lib/crm/types";

/**
 * CRM overlay — the parts of the new model that are genuinely NEW data.
 *
 * Companies and deals are derived from the live brand store rather than stored
 * again (see `src/lib/crm/graph.ts`), because keeping a second copy while lead
 * edits still write to `brands` would let the two drift apart. Only what has no
 * existing source of truth is persisted here:
 *
 *  - `links`     — a human asserting "this deal belongs to that company", the
 *                  one thing we refuse to infer from names.
 *  - `proposals` — commercial documents with their own value and lifecycle.
 */
export interface CompanyLink {
  dealId: string;
  companyId: string;
  companyName: string;
  linkedById: string;
  linkedByName: string;
  linkedAt: string;
}

export interface CrmOverlay {
  links: CompanyLink[];
  proposals: Proposal[];
}

export interface CrmOverlayStore {
  read(): Promise<CrmOverlay>;
  linkDeal(link: CompanyLink): Promise<void>;
  unlinkDeal(dealId: string): Promise<void>;
  saveProposal(proposal: Proposal): Promise<Proposal>;
  removeProposal(id: string): Promise<void>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "crm.json");

class LocalCrmOverlayStore implements CrmOverlayStore {
  private async readAll(): Promise<CrmOverlay> {
    try {
      const parsed = JSON.parse(await fs.readFile(FILE, "utf8")) as Partial<CrmOverlay>;
      return { links: parsed.links ?? [], proposals: parsed.proposals ?? [] };
    } catch {
      return { links: [], proposals: [] };
    }
  }
  private async writeAll(overlay: CrmOverlay): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(overlay, null, 2), "utf8");
  }
  async read() {
    return this.readAll();
  }
  async linkDeal(link: CompanyLink) {
    const o = await this.readAll();
    o.links = [...o.links.filter((l) => l.dealId !== link.dealId), link];
    await this.writeAll(o);
  }
  async unlinkDeal(dealId: string) {
    const o = await this.readAll();
    o.links = o.links.filter((l) => l.dealId !== dealId);
    await this.writeAll(o);
  }
  async saveProposal(proposal: Proposal) {
    const o = await this.readAll();
    o.proposals = [...o.proposals.filter((p) => p.id !== proposal.id), proposal];
    await this.writeAll(o);
    return proposal;
  }
  async removeProposal(id: string) {
    const o = await this.readAll();
    o.proposals = o.proposals.filter((p) => p.id !== id);
    await this.writeAll(o);
  }
}

/** Cosmos: container `crm`, partitioned by /companyId. */
class CosmosCrmOverlayStore implements CrmOverlayStore {
  private container() {
    const db = getCosmosDb();
    if (!db) throw new Error("Cosmos DB is not configured");
    return db.container("crm");
  }
  async read(): Promise<CrmOverlay> {
    const { resources } = await this.container()
      .items.readAll<{ type?: string } & Record<string, unknown>>()
      .fetchAll();
    return {
      links: resources.filter((r) => r.type === "link") as unknown as CompanyLink[],
      proposals: resources.filter((r) => r.type === "proposal") as unknown as Proposal[],
    };
  }
  async linkDeal(link: CompanyLink) {
    await this.container().items.upsert({ ...link, id: `link-${link.dealId}`, type: "link" });
  }
  async unlinkDeal(dealId: string) {
    const existing = (await this.read()).links.find((l) => l.dealId === dealId);
    if (!existing) return;
    await this.container().item(`link-${dealId}`, existing.companyId).delete().catch(() => undefined);
  }
  async saveProposal(proposal: Proposal) {
    await this.container().items.upsert<Proposal>(proposal);
    return proposal;
  }
  async removeProposal(id: string) {
    const existing = (await this.read()).proposals.find((p) => p.id === id);
    if (!existing) return;
    await this.container().item(id, existing.companyId).delete().catch(() => undefined);
  }
}

let store: CrmOverlayStore | undefined;

export function getCrmOverlayStore(): CrmOverlayStore {
  if (store) return store;
  store = isCosmosConfigured() ? new CosmosCrmOverlayStore() : new LocalCrmOverlayStore();
  return store;
}
