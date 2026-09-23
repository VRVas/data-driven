import "server-only";
import { dataFs as fs } from "@/lib/recovery/routing";
import path from "node:path";
import { dataDirectory } from "./location";
import datasetJson from "@/data/dataset.json";
import type { Brand, Dataset } from "@/lib/types";
import { isBrandStatus, isPriority, toBrandStatus, toPriority } from "@/lib/vocab";
import { withFileLock, writeJsonAtomic } from "./local-json";
import { getCosmosDb, isCosmosConfigured } from "./cosmos";

const SEED = (datasetJson as unknown as Dataset).brands;

/**
 * Heal records written under an older vocabulary.
 *
 * Three renames so far: `followUp` became `followUpDate`, the Hot/Warm/Cold
 * Lead priorities became High/Medium/Low, and the eight workbook stages became
 * the six the team agreed. Reading through this is what stops a rename silently
 * blanking data already in Cosmos - the old shape is dropped on the way through,
 * so the next save heals the record for good.
 */
export function normaliseBrand(raw: Brand): Brand {
  const legacy = raw as Brand & { followUp?: string | null };
  let out = raw;
  if (legacy.followUp !== undefined) {
    const { followUp, ...rest } = legacy;
    out = { ...rest, followUpDate: rest.followUpDate ?? followUp ?? null };
  }
  // Read as unknown: the declared type says Priority, but the point of this
  // function is the rows where that is not yet true.
  const priority: unknown = out.priority;
  if (typeof priority === "string" && priority !== "" && !isPriority(priority)) {
    out = { ...out, priority: toPriority(priority) };
  }
  const status: unknown = out.status;
  if (typeof status === "string" && status !== "" && !isBrandStatus(status)) {
    out = { ...out, status: toBrandStatus(status) };
  }
  return out;
}

const normaliseAll = (rows: Brand[]): Brand[] => rows.map(normaliseBrand);

export interface BrandStore {
  list(): Promise<Brand[]>;
  get(id: string): Promise<Brand | null>;
  save(brand: Brand): Promise<Brand>;
  remove(id: string): Promise<void>;
}

// --------------------------------------------------------------------------
// Local file store (development) - .data/brands.json, seeded from the ETL
// --------------------------------------------------------------------------
const DATA_DIR = dataDirectory();
const BRANDS_FILE = path.join(DATA_DIR, "brands.json");

class LocalBrandStore implements BrandStore {
  private async readAll(): Promise<Brand[]> {
    try {
      return normaliseAll(JSON.parse(await fs.readFile(BRANDS_FILE, "utf8")) as Brand[]);
    } catch {
      await this.writeAll(SEED); // first run: seed from the cleaned dataset
      return SEED;
    }
  }
  private async writeAll(brands: Brand[]): Promise<void> {
    await writeJsonAtomic(BRANDS_FILE, brands);
  }
  async list(): Promise<Brand[]> {
    return this.readAll();
  }
  async get(id: string): Promise<Brand | null> {
    return (await this.readAll()).find((b) => b.id === id) ?? null;
  }
  /** Locked: two saves racing would otherwise each write a whole file from its own stale read. */
  async save(brand: Brand): Promise<Brand> {
    await withFileLock(BRANDS_FILE, async () => {
      const all = await this.readAll();
      const i = all.findIndex((b) => b.id === brand.id);
      if (i >= 0) all[i] = brand;
      else all.push(brand);
      await this.writeAll(all);
    });
    return brand;
  }
  async remove(id: string): Promise<void> {
    await withFileLock(BRANDS_FILE, async () => {
      await this.writeAll((await this.readAll()).filter((b) => b.id !== id));
    });
  }
}

// --------------------------------------------------------------------------
// Cosmos DB store (production) - container "brands", partition key /id
// --------------------------------------------------------------------------
class CosmosBrandStore implements BrandStore {
  // Seed the empty container at most once per process (parity with LocalBrandStore).
  private static seeded = false;
  private container() {
    const db = getCosmosDb();
    if (!db) throw new Error("Cosmos DB is not configured");
    return db.container("brands");
  }
  async list(): Promise<Brand[]> {
    const c = this.container();
    const { resources } = await c.items.readAll<Brand>().fetchAll();
    // First run against a freshly provisioned (empty) Cosmos: seed from the
    // cleaned dataset so production matches dev. Cosmos is private (VNet-only),
    // so seeding through the app is the only way to populate it. Upsert by id
    // makes this idempotent and safe across concurrent replicas.
    if (resources.length > 0 || CosmosBrandStore.seeded || process.env.DATA_RECOVERY_ENABLED === "true") return normaliseAll(resources);
    CosmosBrandStore.seeded = true;
    await Promise.all(SEED.map((b) => c.items.upsert<Brand>(b)));
    return SEED;
  }
  async get(id: string): Promise<Brand | null> {
    try {
      const { resource } = await this.container().item(id, id).read<Brand>();
      return resource ? normaliseBrand(resource) : null;
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
