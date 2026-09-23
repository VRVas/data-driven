import "server-only";
import { dataFs as fs } from "@/lib/recovery/routing";
import path from "node:path";
import { dataDirectory } from "./location";
import datasetJson from "@/data/dataset.json";
import type { Agent, Dataset } from "@/lib/types";
import { isBrandStatus, isPriority, toBrandStatus, toPriority } from "@/lib/vocab";
import { writeJsonAtomic } from "./local-json";
import { getCosmosDb, isCosmosConfigured } from "./cosmos";

const SEED = (datasetJson as unknown as Dataset).agents;

/** Agents carry the same vocabularies as leads, so they heal the same way. */
const normaliseAgent = (a: Agent): Agent => {
  let out = a;
  const p: unknown = out.priority;
  if (typeof p === "string" && p !== "" && !isPriority(p)) out = { ...out, priority: toPriority(p) };
  const s: unknown = out.status;
  if (typeof s === "string" && s !== "" && !isBrandStatus(s)) out = { ...out, status: toBrandStatus(s) };
  return out;
};
const normaliseAll = (rows: Agent[]): Agent[] => rows.map(normaliseAgent);

export interface AgentStore {
  list(): Promise<Agent[]>;
  get(id: string): Promise<Agent | null>;
  save(agent: Agent): Promise<Agent>;
  remove(id: string): Promise<void>;
}

// --------------------------------------------------------------------------
// Local file store (development) - .data/agents.json, seeded from the ETL
// --------------------------------------------------------------------------
const DATA_DIR = dataDirectory();
const AGENTS_FILE = path.join(DATA_DIR, "agents.json");

class LocalAgentStore implements AgentStore {
  private async readAll(): Promise<Agent[]> {
    try {
      return normaliseAll(JSON.parse(await fs.readFile(AGENTS_FILE, "utf8")) as Agent[]);
    } catch {
      await this.writeAll(SEED);
      return SEED;
    }
  }
  private async writeAll(agents: Agent[]): Promise<void> {
    await writeJsonAtomic(AGENTS_FILE, agents);
  }
  async list(): Promise<Agent[]> {
    return this.readAll();
  }
  async get(id: string): Promise<Agent | null> {
    return (await this.readAll()).find((a) => a.id === id) ?? null;
  }
  async save(agent: Agent): Promise<Agent> {
    const all = await this.readAll();
    const i = all.findIndex((a) => a.id === agent.id);
    if (i >= 0) all[i] = agent;
    else all.push(agent);
    await this.writeAll(all);
    return agent;
  }
  async remove(id: string): Promise<void> {
    await this.writeAll((await this.readAll()).filter((a) => a.id !== id));
  }
}

// --------------------------------------------------------------------------
// Cosmos DB store (production) - container "agents", partition key /id
// --------------------------------------------------------------------------
class CosmosAgentStore implements AgentStore {
  // Seed the empty container at most once per process (parity with LocalAgentStore).
  private static seeded = false;
  private container() {
    const db = getCosmosDb();
    if (!db) throw new Error("Cosmos DB is not configured");
    return db.container("agents");
  }
  async list(): Promise<Agent[]> {
    const c = this.container();
    const { resources } = await c.items.readAll<Agent>().fetchAll();
    // First run against a freshly provisioned (empty) Cosmos: seed from the
    // cleaned dataset so production matches dev (see CosmosBrandStore).
    if (resources.length > 0 || CosmosAgentStore.seeded || process.env.DATA_RECOVERY_ENABLED === "true") return normaliseAll(resources);
    CosmosAgentStore.seeded = true;
    await Promise.all(SEED.map((a) => c.items.upsert<Agent>(a)));
    return SEED;
  }
  async get(id: string): Promise<Agent | null> {
    try {
      const { resource } = await this.container().item(id, id).read<Agent>();
      return resource ? normaliseAgent(resource) : null;
    } catch {
      return null;
    }
  }
  async save(agent: Agent): Promise<Agent> {
    const { resource } = await this.container().items.upsert<Agent>(agent);
    return (resource as Agent) ?? agent;
  }
  async remove(id: string): Promise<void> {
    await this.container().item(id, id).delete();
  }
}

let store: AgentStore | undefined;

export function getAgentStore(): AgentStore {
  if (store) return store;
  if (isCosmosConfigured()) {
    store = new CosmosAgentStore();
  } else if (process.env.NODE_ENV === "production") {
    throw new Error("COSMOS_ENDPOINT is required in production for the agent store.");
  } else {
    store = new LocalAgentStore();
  }
  return store;
}
