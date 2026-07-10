import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getCosmosDb, isCosmosConfigured } from "./cosmos";
import type { UserRole } from "@/lib/auth/roles";

export type { UserRole };

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  createdAt: string;
}

export interface UserStore {
  findByEmail(email: string): Promise<AppUser | null>;
  findById(id: string): Promise<AppUser | null>;
  list(): Promise<AppUser[]>;
  create(input: { email: string; name: string; passwordHash: string }): Promise<AppUser>;
  setRole(id: string, role: UserRole): Promise<AppUser | null>;
}

/**
 * Normalise roles for back-compat with records written before roles existed:
 *  - if nobody has a role yet, the earliest-created account becomes `admin`
 *    (auto-migration — the founding user keeps full control);
 *  - any other missing role defaults to `member` (least privilege).
 */
function normalizeRoles(users: AppUser[]): AppUser[] {
  if (users.some((u) => u.role)) {
    return users.map((u) => ({ ...u, role: u.role ?? "member" }));
  }
  const earliest = [...users].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))[0];
  return users.map((u) => ({ ...u, role: u.id === earliest?.id ? "admin" : "member" }));
}

// --------------------------------------------------------------------------
// Local file store (development only) — persists to .data/users.json
// --------------------------------------------------------------------------
const DATA_DIR = path.join(process.cwd(), ".data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

class LocalUserStore implements UserStore {
  private async readAll(): Promise<AppUser[]> {
    try {
      return normalizeRoles(JSON.parse(await fs.readFile(USERS_FILE, "utf8")) as AppUser[]);
    } catch {
      return [];
    }
  }
  private async writeAll(users: AppUser[]): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
  }
  async list(): Promise<AppUser[]> {
    return this.readAll();
  }
  async findByEmail(email: string): Promise<AppUser | null> {
    return (await this.readAll()).find((u) => u.email === email.toLowerCase()) ?? null;
  }
  async findById(id: string): Promise<AppUser | null> {
    return (await this.readAll()).find((u) => u.id === id) ?? null;
  }
  async create(input: { email: string; name: string; passwordHash: string }): Promise<AppUser> {
    const users = await this.readAll();
    const user: AppUser = {
      id: randomUUID(),
      email: input.email.toLowerCase(),
      name: input.name,
      role: users.length === 0 ? "admin" : "member", // founder gets the keys
      passwordHash: input.passwordHash,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    await this.writeAll(users);
    return user;
  }
  async setRole(id: string, role: UserRole): Promise<AppUser | null> {
    const users = await this.readAll();
    const user = users.find((u) => u.id === id);
    if (!user) return null;
    user.role = role;
    await this.writeAll(users);
    return user;
  }
}

// --------------------------------------------------------------------------
// Cosmos DB store (production) — container "users", partition key /email
// --------------------------------------------------------------------------
class CosmosUserStore implements UserStore {
  private container() {
    const db = getCosmosDb();
    if (!db) throw new Error("Cosmos DB is not configured");
    return db.container("users");
  }
  async list(): Promise<AppUser[]> {
    const { resources } = await this.container().items.readAll<AppUser>().fetchAll();
    return normalizeRoles(resources);
  }
  async findByEmail(email: string): Promise<AppUser | null> {
    return (await this.list()).find((u) => u.email === email.toLowerCase()) ?? null;
  }
  async findById(id: string): Promise<AppUser | null> {
    return (await this.list()).find((u) => u.id === id) ?? null;
  }
  async create(input: { email: string; name: string; passwordHash: string }): Promise<AppUser> {
    const existing = await this.list();
    const user: AppUser = {
      id: randomUUID(),
      email: input.email.toLowerCase(),
      name: input.name,
      role: existing.length === 0 ? "admin" : "member",
      passwordHash: input.passwordHash,
      createdAt: new Date().toISOString(),
    };
    await this.container().items.create(user);
    return user;
  }
  async setRole(id: string, role: UserRole): Promise<AppUser | null> {
    const user = await this.findById(id);
    if (!user) return null;
    const updated: AppUser = { ...user, role };
    await this.container().items.upsert<AppUser>(updated);
    return updated;
  }
}

let store: UserStore | undefined;

export function getUserStore(): UserStore {
  if (store) return store;
  if (isCosmosConfigured()) {
    store = new CosmosUserStore();
  } else if (process.env.NODE_ENV === "production") {
    // Never fall back to the local file store in production.
    throw new Error("COSMOS_ENDPOINT is required in production for the user store.");
  } else {
    store = new LocalUserStore();
  }
  return store;
}
