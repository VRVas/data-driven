import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { DocFile } from "@/lib/copilot/documents";
import { writeJsonAtomic } from "./local-json";
import { getCosmosDb, isCosmosConfigured } from "./cosmos";

export interface DocRegistry {
  userId: string;
  vectorStoreId: string | null;
  files: DocFile[];
}

export interface DocRegistryStore {
  get(userId: string): Promise<DocRegistry>;
  setVectorStore(userId: string, vectorStoreId: string): Promise<void>;
  addFile(userId: string, file: DocFile): Promise<void>;
  removeFile(userId: string, fileId: string): Promise<void>;
}

const empty = (userId: string): DocRegistry => ({ userId, vectorStoreId: null, files: [] });

// --------------------------------------------------------------------------
// Local file store (development) - .data/documents.json keyed by userId.
// --------------------------------------------------------------------------
const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "documents.json");

class LocalDocRegistryStore implements DocRegistryStore {
  private async readAll(): Promise<Record<string, DocRegistry>> {
    try {
      return JSON.parse(await fs.readFile(FILE, "utf8")) as Record<string, DocRegistry>;
    } catch {
      return {};
    }
  }
  private async writeAll(all: Record<string, DocRegistry>): Promise<void> {
    await writeJsonAtomic(FILE, all);
  }
  async get(userId: string): Promise<DocRegistry> {
    return (await this.readAll())[userId] ?? empty(userId);
  }
  async setVectorStore(userId: string, vectorStoreId: string): Promise<void> {
    const all = await this.readAll();
    all[userId] = { ...(all[userId] ?? empty(userId)), userId, vectorStoreId };
    await this.writeAll(all);
  }
  async addFile(userId: string, file: DocFile): Promise<void> {
    const all = await this.readAll();
    const reg = all[userId] ?? empty(userId);
    reg.files = [...reg.files.filter((f) => f.id !== file.id), file];
    all[userId] = reg;
    await this.writeAll(all);
  }
  async removeFile(userId: string, fileId: string): Promise<void> {
    const all = await this.readAll();
    const reg = all[userId];
    if (!reg) return;
    reg.files = reg.files.filter((f) => f.id !== fileId);
    all[userId] = reg;
    await this.writeAll(all);
  }
}

// --------------------------------------------------------------------------
// Cosmos DB store (production) - container "documents", partition key /userId.
// --------------------------------------------------------------------------
class CosmosDocRegistryStore implements DocRegistryStore {
  private container() {
    const db = getCosmosDb();
    if (!db) throw new Error("Cosmos DB is not configured");
    return db.container("documents");
  }
  async get(userId: string): Promise<DocRegistry> {
    try {
      const { resource } = await this.container().item(userId, userId).read<DocRegistry & { id: string }>();
      return resource ? { userId, vectorStoreId: resource.vectorStoreId, files: resource.files ?? [] } : empty(userId);
    } catch {
      return empty(userId);
    }
  }
  private async upsert(reg: DocRegistry): Promise<void> {
    await this.container().items.upsert({ id: reg.userId, ...reg });
  }
  async setVectorStore(userId: string, vectorStoreId: string): Promise<void> {
    const reg = await this.get(userId);
    await this.upsert({ ...reg, vectorStoreId });
  }
  async addFile(userId: string, file: DocFile): Promise<void> {
    const reg = await this.get(userId);
    reg.files = [...reg.files.filter((f) => f.id !== file.id), file];
    await this.upsert(reg);
  }
  async removeFile(userId: string, fileId: string): Promise<void> {
    const reg = await this.get(userId);
    reg.files = reg.files.filter((f) => f.id !== fileId);
    await this.upsert(reg);
  }
}

let store: DocRegistryStore | undefined;

export function getDocRegistryStore(): DocRegistryStore {
  if (store) return store;
  store = isCosmosConfigured() ? new CosmosDocRegistryStore() : new LocalDocRegistryStore();
  return store;
}
