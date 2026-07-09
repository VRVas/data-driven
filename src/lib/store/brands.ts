import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import datasetJson from "@/data/dataset.json";
import type { Brand, Dataset } from "@/lib/types";
import { getCosmosDb, isCosmosConfigured } from "./cosmos";

const SEED = (datasetJson as unknown as Dataset).brands;

export interface BrandStore {
  list(): Promise<Brand[]>;
  get(id: string): Promise<Brand | null>;
  save(brand: Brand): Promise<Brand>;
  remove(id: string): Promise<void>;
}

// --------------------------------------------------------------------------
// Local file store (development) — .data/brands.json, seeded from the ETL
// --------------------------------------------------------------------------
const DATA_DIR = path.join(process.cwd(), ".data");
const BRANDS_FILE = path.join(DATA_DIR, "brands.json");

class LocalBrandStore implements BrandStore {
  private async readAll(): Promise<Brand[]> {
    try {
      return JSON.parse(await fs.readFile(BRANDS_FILE, "utf8")) as Brand[];
    } catch {
      await this.writeAll(SEED); // first run: seed from the cleaned dataset
      return SEED;
    }
  }
  private async writeAll(brands: Brand[]): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(BRANDS_FILE, JSON.stringify(brands, null, 2), "utf8");
  }
  async list(): Promise<Brand[]> {
    return this.readAll();
  }
  async get(id: string): Promise<Brand | null> {
    return (await this.readAll()).find((b) => b.id === id) ?? null;
  }
  async save(brand: Brand): Promise<Brand> {
    const all = await this.readAll();
    const i = all.findIndex((b) => b.id === brand.id);
    if (i >= 0) all[i] = brand;
    else all.push(brand);
    await this.writeAll(all);
    return brand;
  }
  async remove(id: string): Promise<void> {
    await this.writeAll((await this.readAll()).filter((b) => b.id !== id));
  }
}

// --------------------------------------------------------------------------
// Cosmos DB store (production) — container "brands", partition key /id
// --------------------------------------------------------------------------
class CosmosBrandStore implements BrandStore {
  private container() {
    const db = getCosmosDb();
    if (!db) throw new Error("Cosmos DB is not configured");
    return db.container("brands");
  }
  async list(): Promise<Brand[]> {
    const { resources } = await this.container().items.readAll<Brand>().fetchAll();
    return resources;
  }
  async get(id: string): Promise<Brand | null> {
    try {
      const { resource } = await this.container().item(id, id).read<Brand>();
      return resource ?? null;
    } catch {
      return null;
    }
  }
  async save(brand: Brand): Promise<Brand> {
    const { resource } = await this.container().items.upsert<Brand>(brand);
    return (resource as Brand) ?? brand;
  }
  async remove(id: string): Promise<void> {
    await this.container().item(id, id).delete();
  }
}

let store: BrandStore | undefined;

export function getBrandStore(): BrandStore {
  if (store) return store;
  if (isCosmosConfigured()) {
    store = new CosmosBrandStore();
  } else if (process.env.NODE_ENV === "production") {
    throw new Error("COSMOS_ENDPOINT is required in production for the brand store.");
  } else {
    store = new LocalBrandStore();
  }
  return store;
}
