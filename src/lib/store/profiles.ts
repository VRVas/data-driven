import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getCosmosDb, isCosmosConfigured } from "./cosmos";
import { SYSTEM_PROFILES, type Profile } from "@/lib/auth/profiles";

export interface ProfileStore {
  list(): Promise<Profile[]>;
  get(id: string): Promise<Profile | null>;
  save(profile: Profile): Promise<Profile>;
  remove(id: string): Promise<void>;
}

/** Seeded profiles are always present, and stored edits take precedence. */
function withSystemProfiles(stored: Profile[]): Profile[] {
  const byId = new Map<string, Profile>(SYSTEM_PROFILES.map((p) => [p.id, p]));
  for (const p of stored) byId.set(p.id, p);
  return [...byId.values()];
}

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "profiles.json");

class LocalProfileStore implements ProfileStore {
  private async readAll(): Promise<Profile[]> {
    try {
      return JSON.parse(await fs.readFile(FILE, "utf8")) as Profile[];
    } catch {
      return [];
    }
  }
  private async writeAll(profiles: Profile[]): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(profiles, null, 2), "utf8");
  }
  async list(): Promise<Profile[]> {
    return withSystemProfiles(await this.readAll());
  }
  async get(id: string): Promise<Profile | null> {
    return (await this.list()).find((p) => p.id === id) ?? null;
  }
  async save(profile: Profile): Promise<Profile> {
    const stored = await this.readAll();
    const next = stored.filter((p) => p.id !== profile.id);
    next.push(profile);
    await this.writeAll(next);
    return profile;
  }
  async remove(id: string): Promise<void> {
    await this.writeAll((await this.readAll()).filter((p) => p.id !== id));
  }
}

class CosmosProfileStore implements ProfileStore {
  private container() {
    const db = getCosmosDb();
    if (!db) throw new Error("Cosmos DB is not configured");
    return db.container("profiles");
  }
  async list(): Promise<Profile[]> {
    const { resources } = await this.container().items.readAll<Profile>().fetchAll();
    return withSystemProfiles(resources);
  }
  async get(id: string): Promise<Profile | null> {
    return (await this.list()).find((p) => p.id === id) ?? null;
  }
  async save(profile: Profile): Promise<Profile> {
    await this.container().items.upsert<Profile>(profile);
    return profile;
  }
  async remove(id: string): Promise<void> {
    await this.container().item(id, id).delete().catch(() => undefined);
  }
}

let cached: ProfileStore | null = null;

export function getProfileStore(): ProfileStore {
  if (cached) return cached;
  cached = isCosmosConfigured() ? new CosmosProfileStore() : new LocalProfileStore();
  return cached;
}
