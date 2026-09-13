import "server-only";
import path from "node:path";
import { getCosmosDb, isCosmosConfigured } from "./cosmos";
import { mutateJsonArray, readJsonArray } from "./local-json";

/**
 * The notes thread on a lead.
 *
 * `brand.notes` is the initial note: what this lead is, how it came in, what to
 * be careful of. It is written once when the lead opens and it stays put.
 * Everything learned afterwards is appended here instead, attributed and dated.
 *
 * The point is that a single shared text field has no memory. Whoever saves
 * next replaces what the last person wrote, silently, with no record that
 * anything was lost - so the field decays into whatever the most recent editor
 * happened to care about, which is exactly why nobody trusts it enough to read
 * it. Appending is what makes the notes worth reading a year later.
 *
 * Append-only on purpose: there is no edit and no delete. A thread that can be
 * rewritten is back to having no memory. Corrections are appended like
 * anything else.
 */
export interface NoteEntry {
  id: string;
  /** The lead. Also the partition key: every read is "this lead's thread". */
  leadId: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

export interface NoteStore {
  listForLead(leadId: string, limit?: number): Promise<NoteEntry[]>;
  /** One round trip for a page showing several leads' threads. */
  listForLeads(leadIds: string[]): Promise<NoteEntry[]>;
  append(entry: NoteEntry): Promise<NoteEntry>;
  countByLead(): Promise<Record<string, number>>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "notes.json");

/** Oldest first: a notes thread reads as a story, not as a feed. */
const byOldest = (a: NoteEntry, b: NoteEntry) => a.createdAt.localeCompare(b.createdAt);

class LocalNoteStore implements NoteStore {
  private readAll(): Promise<NoteEntry[]> {
    return readJsonArray<NoteEntry>(FILE);
  }
  async listForLead(leadId: string, limit = 200): Promise<NoteEntry[]> {
    return (await this.readAll()).filter((n) => n.leadId === leadId).sort(byOldest).slice(0, limit);
  }
  async listForLeads(leadIds: string[]): Promise<NoteEntry[]> {
    const wanted = new Set(leadIds);
    return (await this.readAll()).filter((n) => wanted.has(n.leadId)).sort(byOldest);
  }
  async append(entry: NoteEntry): Promise<NoteEntry> {
    await mutateJsonArray<NoteEntry>(FILE, (rows) => [...rows, entry]);
    return entry;
  }
  async countByLead(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const n of await this.readAll()) out[n.leadId] = (out[n.leadId] ?? 0) + 1;
    return out;
  }
}

class CosmosNoteStore implements NoteStore {
  private container() {
    const db = getCosmosDb();
    if (!db) throw new Error("Cosmos DB is not configured");
    return db.container("notes");
  }
  async listForLead(leadId: string, limit = 200): Promise<NoteEntry[]> {
    const { resources } = await this.container()
      .items.query<NoteEntry>({
        query: "SELECT * FROM c WHERE c.leadId = @l ORDER BY c.createdAt ASC OFFSET 0 LIMIT @n",
        parameters: [
          { name: "@l", value: leadId },
          { name: "@n", value: limit },
        ],
      })
      .fetchAll();
    return resources;
  }
  async listForLeads(leadIds: string[]): Promise<NoteEntry[]> {
    if (!leadIds.length) return [];
    const { resources } = await this.container()
      .items.query<NoteEntry>({
        query: "SELECT * FROM c WHERE ARRAY_CONTAINS(@ids, c.leadId) ORDER BY c.createdAt ASC",
        parameters: [{ name: "@ids", value: leadIds }],
      })
      .fetchAll();
    return resources;
  }
  async append(entry: NoteEntry): Promise<NoteEntry> {
    const { resource } = await this.container().items.create<NoteEntry>(entry);
    return (resource as NoteEntry) ?? entry;
  }
  async countByLead(): Promise<Record<string, number>> {
    const { resources } = await this.container()
      .items.query<{ leadId: string; n: number }>({
        query: "SELECT c.leadId, COUNT(1) AS n FROM c GROUP BY c.leadId",
      })
      .fetchAll();
    const out: Record<string, number> = {};
    for (const r of resources) out[r.leadId] = r.n;
    return out;
  }
}

let store: NoteStore | undefined;

export function getNoteStore(): NoteStore {
  store ??= isCosmosConfigured() ? new CosmosNoteStore() : new LocalNoteStore();
  return store;
}
