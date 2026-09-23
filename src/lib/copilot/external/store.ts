import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getCosmosDb } from "@/lib/store/cosmos";
import { withFileLock, writeJsonAtomic } from "@/lib/store/local-json";
import type { IntegrationDocument } from "./contracts";

export interface ScanOptions {
  partitionKey?: string;
  states?: string[];
  undelivered?: boolean;
  executingActions?: boolean;
  newestFirst?: boolean;
  limit?: number;
}

export interface IntegrationStore {
  get<Document extends IntegrationDocument>(partitionKey: string, id: string): Promise<Document | null>;
  create<Document extends IntegrationDocument>(document: Document): Promise<Document | null>;
  replace<Document extends IntegrationDocument>(document: Document, etag: string): Promise<Document | null>;
  scan<Document extends IntegrationDocument>(kind: string, options?: ScanOptions): Promise<Document[]>;
}

export class LocalIntegrationStore implements IntegrationStore {
  constructor(private readonly file: string) {}

  private async read(): Promise<IntegrationDocument[]> {
    try {
      const rows = JSON.parse(await fs.readFile(this.file, "utf8")) as IntegrationDocument[];
      if (!Array.isArray(rows)) throw new Error("Invalid integration store");
      return rows.filter((row) => !row.ttl || row.ttl < 0 || Date.parse(row.updatedAt) + row.ttl * 1000 > Date.now());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async get<Document extends IntegrationDocument>(partitionKey: string, id: string): Promise<Document | null> {
    return (await this.read()).find((row) => row.partitionKey === partitionKey && row.id === id) as Document ?? null;
  }

  async create<Document extends IntegrationDocument>(document: Document): Promise<Document | null> {
    return withFileLock(this.file, async () => {
      const rows = await this.read();
      if (rows.some((row) => row.partitionKey === document.partitionKey && row.id === document.id)) return null;
      const saved = { ...document, _etag: randomUUID() };
      await writeJsonAtomic(this.file, [...rows, saved]);
      return saved;
    });
  }

  async replace<Document extends IntegrationDocument>(document: Document, etag: string): Promise<Document | null> {
    return withFileLock(this.file, async () => {
      const rows = await this.read();
      const index = rows.findIndex((row) => row.partitionKey === document.partitionKey && row.id === document.id);
      if (index < 0 || rows[index]._etag !== etag) return null;
      const saved = { ...document, _etag: randomUUID(), updatedAt: new Date().toISOString() };
      rows[index] = saved;
      await writeJsonAtomic(this.file, rows);
      return saved;
    });
  }

  async scan<Document extends IntegrationDocument>(kind: string, options: ScanOptions = {}): Promise<Document[]> {
    return (await this.read())
      .filter((row) => row.kind === kind && (!options.partitionKey || row.partitionKey === options.partitionKey)
        && (!options.states || options.states.includes((row as IntegrationDocument & { state: string }).state))
        && (!options.undelivered || (row as IntegrationDocument & { deliveryPublished?: boolean }).deliveryPublished === false)
        && (!options.executingActions || (row as IntegrationDocument & { actions?: { state: string }[] }).actions?.some((action) => action.state === "executing")))
      .sort((left, right) => (options.newestFirst ? -1 : 1) * (left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)))
      .slice(0, options.limit ?? 100) as Document[];
  }
}

export class CosmosIntegrationStore implements IntegrationStore {
  private container() {
    const database = getCosmosDb();
    if (!database) throw new Error("Cosmos is not configured");
    return database.container("copilotIntegrations");
  }

  async get<Document extends IntegrationDocument>(partitionKey: string, id: string): Promise<Document | null> {
    try {
      const { resource } = await this.container().item(id, partitionKey).read<Document>();
      return resource ?? null;
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      throw error;
    }
  }

  async create<Document extends IntegrationDocument>(document: Document): Promise<Document | null> {
    try {
      const { resource } = await this.container().items.create(document);
      if (!resource) throw new Error("Cosmos did not return the created document");
      return resource as Document;
    } catch (error) {
      if ((error as { code?: number }).code === 409) return null;
      throw error;
    }
  }

  async replace<Document extends IntegrationDocument>(document: Document, etag: string): Promise<Document | null> {
    try {
      const { resource } = await this.container().item(document.id, document.partitionKey)
        .replace<Document>({ ...document, updatedAt: new Date().toISOString() }, { accessCondition: { type: "IfMatch", condition: etag } });
      if (!resource) throw new Error("Cosmos did not return the replaced document");
      return resource as Document;
    } catch (error) {
      if ([404, 412].includes((error as { code: number }).code)) return null;
      throw error;
    }
  }

  async scan<Document extends IntegrationDocument>(kind: string, options: ScanOptions = {}): Promise<Document[]> {
    const parameters = [
      { name: "@kind", value: kind },
      { name: "@limit", value: Math.min(options.limit ?? 100, 1000) },
      ...(options.partitionKey ? [{ name: "@partition", value: options.partitionKey }] : []),
      ...(options.states ? [{ name: "@states", value: options.states }] : []),
    ];
    const { resources } = await this.container().items.query<Document>({
      query: `SELECT TOP @limit * FROM c WHERE c.kind = @kind${options.partitionKey ? " AND c.partitionKey = @partition" : ""}${options.states ? " AND ARRAY_CONTAINS(@states, c.state)" : ""}${options.undelivered ? " AND c.deliveryPublished = false" : ""}${options.executingActions ? " AND EXISTS(SELECT VALUE action FROM action IN c.actions WHERE action.state = 'executing')" : ""} ORDER BY c.createdAt ${options.newestFirst ? "DESC" : "ASC"}`,
      parameters,
    }, options.partitionKey ? { partitionKey: options.partitionKey } : undefined).fetchAll();
    return resources;
  }
}

let store: IntegrationStore | undefined;
export function integrationStore(): IntegrationStore {
  if (!store) {
    if (!process.env.COSMOS_ENDPOINT && process.env.NODE_ENV === "production" && process.env.COPILOT_EXTERNAL_ENABLED === "true") {
      throw new Error("External copilot requires Cosmos in production");
    }
    store = process.env.COSMOS_ENDPOINT ? new CosmosIntegrationStore()
      : new LocalIntegrationStore(path.join(process.cwd(), ".data", "copilot-integrations.json"));
  }
  return store;
}

export function documentBase(kind: string, partitionKey: string, id: string): IntegrationDocument {
  const now = new Date().toISOString();
  return { id, kind, partitionKey, createdAt: now, updatedAt: now, ttl: 604800 };
}