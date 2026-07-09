import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getCosmosDb, isCosmosConfigured } from "./cosmos";

export interface AppUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
}

export interface UserStore {
  findByEmail(email: string): Promise<AppUser | null>;
  create(input: { email: string; name: string; passwordHash: string }): Promise<AppUser>;
}

// --------------------------------------------------------------------------
// Local file store (development only) — persists to .data/users.json
// --------------------------------------------------------------------------
const DATA_DIR = path.join(process.cwd(), ".data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

class LocalUserStore implements UserStore {
  private async readAll(): Promise<AppUser[]> {
    try {
      return JSON.parse(await fs.readFile(USERS_FILE, "utf8")) as AppUser[];
    } catch {
      return [];
    }
  }
  private async writeAll(users: AppUser[]): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
  }
  async findByEmail(email: string): Promise<AppUser | null> {
    const users = await this.readAll();
    return users.find((u) => u.email === email.toLowerCase()) ?? null;
  }
  async create(input: { email: string; name: string; passwordHash: string }): Promise<AppUser> {
    const users = await this.readAll();
    const user: AppUser = {
      id: randomUUID(),
      email: input.email.toLowerCase(),
      name: input.name,
      passwordHash: input.passwordHash,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    await this.writeAll(users);
    return user;
  }
}

// --------------------------------------------------------------------------
// Cosmos DB store (production) — container "users", partition key /email
// --------------------------------------------------------------------------
class CosmosUserStore implements UserStore {
  async findByEmail(email: string): Promise<AppUser | null> {
    const db = getCosmosDb();
    if (!db) return null;
    const { resources } = await db
      .container("users")
      .items.query<AppUser>({
        query: "SELECT * FROM c WHERE c.email = @e",
        parameters: [{ name: "@e", value: email.toLowerCase() }],
      })
      .fetchAll();
    return resources[0] ?? null;
  }
  async create(input: { email: string; name: string; passwordHash: string }): Promise<AppUser> {
    const db = getCosmosDb();
    if (!db) throw new Error("Cosmos DB is not configured");
    const user: AppUser = {
      id: randomUUID(),
      email: input.email.toLowerCase(),
      name: input.name,
      passwordHash: input.passwordHash,
      createdAt: new Date().toISOString(),
    };
    await db.container("users").items.create(user);
    return user;
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
