import "server-only";
import path from "node:path";
import { getCosmosDb, isCosmosConfigured } from "./cosmos";
import { mutateJsonArray, readJsonArray } from "./local-json";

/**
 * Comments on a record - the discussion, as opposed to the summary.
 *
 * A lead already had `notes`: one text box, typed at creation and then
 * invisible almost everywhere. Two things were wrong with it, and only one is
 * about where it was displayed. The other is that a single shared field has no
 * memory. Whoever edits next replaces what the last person wrote, silently,
 * with no record that anything was lost - so the field decays into whatever
 * the most recent editor happened to care about, which is exactly why nobody
 * trusts it enough to read it.
 *
 * Comments are append-only and attributed. Notes stay: they are the standing
 * summary of what this lead IS, and they belong in the export and the reminder
 * email. Comments are what HAPPENED, in order, with a name and a date against
 * each one. Keeping both means neither has to pretend to be the other.
 */
export type CommentTarget = "lead" | "company";

export interface Comment {
  id: string;
  target: CommentTarget;
  /** Lead id or company id. The partition key: every read is "this record's thread". */
  recordId: string;
  /** Denormalised so the activity feed can name the record without a second lookup. */
  recordName: string | null;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  /** Set rather than deleted, so a thread never silently loses a turn. */
  editedAt: string | null;
}

export interface CommentStore {
  listForRecord(recordId: string, limit?: number): Promise<Comment[]>;
  /** One round trip for a page showing several records' threads. */
  listForRecords(recordIds: string[]): Promise<Comment[]>;
  create(c: Comment): Promise<Comment>;
  get(id: string, recordId: string): Promise<Comment | null>;
  remove(id: string, recordId: string): Promise<void>;
  countByRecord(): Promise<Record<string, number>>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "comments.json");

/** Newest first everywhere: a thread is read from the top. */
const byNewest = (a: Comment, b: Comment) => b.createdAt.localeCompare(a.createdAt);

class LocalCommentStore implements CommentStore {
  private readAll(): Promise<Comment[]> {
    return readJsonArray<Comment>(FILE);
  }
  async listForRecord(recordId: string, limit = 200): Promise<Comment[]> {
    return (await this.readAll()).filter((c) => c.recordId === recordId).sort(byNewest).slice(0, limit);
  }
  async listForRecords(recordIds: string[]): Promise<Comment[]> {
    const wanted = new Set(recordIds);
    return (await this.readAll()).filter((c) => wanted.has(c.recordId)).sort(byNewest);
  }
  async create(c: Comment): Promise<Comment> {
    await mutateJsonArray<Comment>(FILE, (rows) => [...rows, c]);
    return c;
  }
  async get(id: string, recordId: string): Promise<Comment | null> {
    return (await this.readAll()).find((c) => c.id === id && c.recordId === recordId) ?? null;
  }
  async remove(id: string, recordId: string): Promise<void> {
    await mutateJsonArray<Comment>(FILE, (rows) => rows.filter((c) => !(c.id === id && c.recordId === recordId)));
  }
  async countByRecord(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const c of await this.readAll()) out[c.recordId] = (out[c.recordId] ?? 0) + 1;
    return out;
  }
}

class CosmosCommentStore implements CommentStore {
  private container() {
    const db = getCosmosDb();
    if (!db) throw new Error("Cosmos DB is not configured");
    return db.container("comments");
  }
  async listForRecord(recordId: string, limit = 200): Promise<Comment[]> {
    const { resources } = await this.container()
      .items.query<Comment>({
        query: "SELECT * FROM c WHERE c.recordId = @r ORDER BY c.createdAt DESC OFFSET 0 LIMIT @n",
        parameters: [
          { name: "@r", value: recordId },
          { name: "@n", value: limit },
        ],
      })
      .fetchAll();
    return resources;
  }
  async listForRecords(recordIds: string[]): Promise<Comment[]> {
    if (!recordIds.length) return [];
    const { resources } = await this.container()
      .items.query<Comment>({
        query: "SELECT * FROM c WHERE ARRAY_CONTAINS(@ids, c.recordId) ORDER BY c.createdAt DESC",
        parameters: [{ name: "@ids", value: recordIds }],
      })
      .fetchAll();
    return resources;
  }
  async create(c: Comment): Promise<Comment> {
    const { resource } = await this.container().items.create<Comment>(c);
    return (resource as Comment) ?? c;
  }
  async get(id: string, recordId: string): Promise<Comment | null> {
    try {
      const { resource } = await this.container().item(id, recordId).read<Comment>();
      return resource ?? null;
    } catch {
      return null;
    }
  }
  async remove(id: string, recordId: string): Promise<void> {
    try {
      await this.container().item(id, recordId).delete();
    } catch {
      // Already gone.
    }
  }
  async countByRecord(): Promise<Record<string, number>> {
    const { resources } = await this.container()
      .items.query<{ recordId: string; n: number }>({
        query: "SELECT c.recordId, COUNT(1) AS n FROM c GROUP BY c.recordId",
      })
      .fetchAll();
    const out: Record<string, number> = {};
    for (const r of resources) out[r.recordId] = r.n;
    return out;
  }
}

let store: CommentStore | undefined;

export function getCommentStore(): CommentStore {
  if (store) return store;
  store = isCosmosConfigured() ? new CosmosCommentStore() : new LocalCommentStore();
  return store;
}
