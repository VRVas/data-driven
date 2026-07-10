import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getCosmosDb, isCosmosConfigured } from "./cosmos";

export interface SavedView {
  id: string;
  userId: string;
  name: string;
  q: string;
  status: string; // "All" or a BrandStatus
  owner: string; // "All" or an owner name
  sortKey: string;
  sortDir: 1 | -1;
  createdAt: string;
}

export type SavedViewInput = Omit<SavedView, "id" | "createdAt">;

export interface ViewStore {
  listForUser(userId: string): Promise<SavedView[]>;
  create(input: SavedViewInput): Promise<SavedView>;
  remove(id: string, userId: string): Promise<void>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const VIEWS_FILE = path.join(DATA_DIR, "views.json");

class LocalViewStore implements ViewStore {
  private async readAll(): Promise<SavedView[]> {
    try {
      return JSON.parse(await fs.readFile(VIEWS_FILE, "utf8")) as SavedView[];
    } catch {
      return [];
    }
  }
  private async writeAll(views: SavedView[]): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(VIEWS_FILE, JSON.stringify(views, null, 2), "utf8");
  }
  async listForUser(userId: string): Promise<SavedView[]> {
    return (await this.readAll())
      .filter((v) => v.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async create(input: SavedViewInput): Promise<SavedView> {
    const all = await this.readAll();
    const view: SavedView = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    all.push(view);
    await this.writeAll(all);
    return view;
  }
  async remove(id: string, userId: string): Promise<void> {
    await this.writeAll((await this.readAll()).filter((v) => !(v.id === id && v.userId === userId)));
  }
}

class CosmosViewStore implements ViewStore {
  private container() {
    const db = getCosmosDb();
    if (!db) throw new Error("Cosmos DB is not configured");
    return db.container("savedViews");
  }
  async listForUser(userId: string): Promise<SavedView[]> {
    const { resources } = await this.container()
      .items.query<SavedView>({
        query: "SELECT * FROM c WHERE c.userId = @u ORDER BY c.createdAt ASC",
        parameters: [{ name: "@u", value: userId }],
      })
      .fetchAll();
    return resources;
  }
  async create(input: SavedViewInput): Promise<SavedView> {
    const view: SavedView = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    await this.container().items.create<SavedView>(view);
    return view;
  }
  async remove(id: string, userId: string): Promise<void> {
    await this.container().item(id, userId).delete();
  }
}

let store: ViewStore | undefined;

export function getViewStore(): ViewStore {
  if (store) return store;
  store = isCosmosConfigured() ? new CosmosViewStore() : new LocalViewStore();
  return store;
}
