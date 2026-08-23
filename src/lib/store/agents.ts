import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import datasetJson from "@/data/dataset.json";
import type { Agent, Dataset } from "@/lib/types";
import { writeJsonAtomic } from "./local-json";
import { getCosmosDb, isCosmosConfigured } from "./cosmos";

const SEED = (datasetJson as unknown as Dataset).agents;

export interface AgentStore {
  list(): Promise<Agent[]>;
  get(id: string): Promise<Agent | null>;
  save(agent: Agent): Promise<Agent>;
  remove(id: string): Promise<void>;
}

// --------------------------------------------------------------------------
// Local file store (development) - .data/agents.json, seeded from the ETL
// --------------------------------------------------------------------------
const DATA_DIR = path.join(process.cwd(), ".data");
const AGENTS_FILE = path.join(DATA_DIR, "agents.json");

class LocalAgentStore implements AgentStore {
  private async readAll(): Promise<Agent[]> {
    try {
      return JSON.parse(await fs.readFile(AGENTS_FILE, "utf8")) as Agent[];
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
    if (resources.length > 0 || CosmosAgentStore.seeded) return resources;
    CosmosAgentStore.seeded = true;
    await Promise.all(SEED.map((a) => c.items.upsert<Agent>(a)));
    return SEED;
  }
  async get(id: string): Promise<Agent | null> {
    try {
      const { resource } = await this.container().item(id, id).read<Agent>();
      return resource ?? null;
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
