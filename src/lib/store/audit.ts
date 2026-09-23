import "server-only";
import { dataFs as fs } from "@/lib/recovery/routing";
import path from "node:path";
import { dataDirectory } from "./location";
import { randomUUID } from "node:crypto";
import { writeJsonAtomic } from "./local-json";
import { getCosmosDb, isCosmosConfigured } from "./cosmos";

export interface AuditEntry {
  id: string;
  at: string; // ISO timestamp
  actorId: string;
  actorName: string;
  action: string; // dotted verb, e.g. "brand.update", "user.promote", "outreach.send"
  entity: string; // "brand" | "user" | "outreach" | ...
  entityId: string;
  summary: string;
}

export interface AuditStore {
  list(limit?: number): Promise<AuditEntry[]>;
  append(entry: AuditEntry): Promise<AuditEntry>;
}

const DATA_DIR = dataDirectory();
const AUDIT_FILE = path.join(DATA_DIR, "audit.json");

class LocalAuditStore implements AuditStore {
  private async readAll(): Promise<AuditEntry[]> {
    try {
      return JSON.parse(await fs.readFile(AUDIT_FILE, "utf8")) as AuditEntry[];
    } catch {
      return [];
    }
  }
  async list(limit = 200): Promise<AuditEntry[]> {
    const all = await this.readAll();
    return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }
  async append(entry: AuditEntry): Promise<AuditEntry> {
    const all = await this.readAll();
    all.push(entry);
    await writeJsonAtomic(AUDIT_FILE, all);
    return entry;
  }
}

class CosmosAuditStore implements AuditStore {
  private container() {
    const db = getCosmosDb();
    if (!db) throw new Error("Cosmos DB is not configured");
    return db.container("audit");
  }
  async list(limit = 200): Promise<AuditEntry[]> {
    const { resources } = await this.container()
      .items.query<AuditEntry>({
        query: "SELECT * FROM c ORDER BY c.at DESC OFFSET 0 LIMIT @n",
        parameters: [{ name: "@n", value: limit }],
      })
      .fetchAll();
    return resources;
  }
  async append(entry: AuditEntry): Promise<AuditEntry> {
    const { resource } = await this.container().items.create<AuditEntry>(entry);
    return (resource as AuditEntry) ?? entry;
  }
}

let store: AuditStore | undefined;

export function getAuditStore(): AuditStore {
  if (store) return store;
  store = isCosmosConfigured() ? new CosmosAuditStore() : new LocalAuditStore();
  return store;
}

/**
 * Record an action. Audit logging must never break the operation it describes,
 * so failures here are swallowed (best-effort trail).
 */
export async function logAudit(input: Omit<AuditEntry, "id" | "at">): Promise<void> {
  try {
    await getAuditStore().append({ ...input, id: randomUUID(), at: new Date().toISOString() });
  } catch {
    // best-effort - never surface audit failures to the caller
  }
}
