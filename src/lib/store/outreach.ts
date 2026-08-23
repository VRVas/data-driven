import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeJsonAtomic } from "./local-json";
import { getCosmosDb, isCosmosConfigured } from "./cosmos";

export type OutreachStatus =
  | "draft"
  | "pending_approval"
  | "sent"
  | "failed"
  | "cancelled";

export interface Outreach {
  id: string;
  brandId: string;
  brandName: string;
  to: string;
  subject: string;
  body: string;
  templateId: string;
  status: OutreachStatus;
  provider?: string;
  providerMessageId?: string;
  error?: string;
  createdById: string;
  createdByName: string;
  approvedById?: string;
  approvedByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OutreachStore {
  list(limit?: number): Promise<Outreach[]>;
  listForBrand(brandId: string): Promise<Outreach[]>;
  get(id: string): Promise<Outreach | null>;
  create(o: Outreach): Promise<Outreach>;
  update(o: Outreach): Promise<Outreach>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "outreach.json");

class LocalOutreachStore implements OutreachStore {
  private async readAll(): Promise<Outreach[]> {
    try {
      return JSON.parse(await fs.readFile(FILE, "utf8")) as Outreach[];
    } catch {
      return [];
    }
  }
  private async writeAll(rows: Outreach[]): Promise<void> {
    await writeJsonAtomic(FILE, rows);
  }
  async list(limit = 200): Promise<Outreach[]> {
    return (await this.readAll()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  async listForBrand(brandId: string): Promise<Outreach[]> {
    return (await this.list()).filter((o) => o.brandId === brandId);
  }
  async get(id: string): Promise<Outreach | null> {
    return (await this.readAll()).find((o) => o.id === id) ?? null;
  }
  async create(o: Outreach): Promise<Outreach> {
    const all = await this.readAll();
    all.push(o);
    await this.writeAll(all);
    return o;
  }
  async update(o: Outreach): Promise<Outreach> {
    const all = await this.readAll();
    const i = all.findIndex((x) => x.id === o.id);
    if (i >= 0) all[i] = o;
    else all.push(o);
    await this.writeAll(all);
    return o;
  }
}

class CosmosOutreachStore implements OutreachStore {
  private container() {
    const db = getCosmosDb();
    if (!db) throw new Error("Cosmos DB is not configured");
    return db.container("outreach");
  }
  async list(limit = 200): Promise<Outreach[]> {
    const { resources } = await this.container()
      .items.query<Outreach>({
        query: "SELECT * FROM c ORDER BY c.createdAt DESC OFFSET 0 LIMIT @n",
        parameters: [{ name: "@n", value: limit }],
      })
      .fetchAll();
    return resources;
  }
  async listForBrand(brandId: string): Promise<Outreach[]> {
    const { resources } = await this.container()
      .items.query<Outreach>({
        query: "SELECT * FROM c WHERE c.brandId = @b ORDER BY c.createdAt DESC",
        parameters: [{ name: "@b", value: brandId }],
      })
      .fetchAll();
    return resources;
  }
  async get(id: string): Promise<Outreach | null> {
    try {
      const { resource } = await this.container().item(id, id).read<Outreach>();
      return resource ?? null;
    } catch {
      return null;
    }
  }
  async create(o: Outreach): Promise<Outreach> {
    const { resource } = await this.container().items.create<Outreach>(o);
    return (resource as Outreach) ?? o;
  }
  async update(o: Outreach): Promise<Outreach> {
    const { resource } = await this.container().items.upsert<Outreach>(o);
    return (resource as Outreach) ?? o;
  }
}

let store: OutreachStore | undefined;

export function getOutreachStore(): OutreachStore {
  if (store) return store;
  store = isCosmosConfigured() ? new CosmosOutreachStore() : new LocalOutreachStore();
  return store;
}
