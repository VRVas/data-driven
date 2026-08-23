import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getCosmosDb, isCosmosConfigured } from "./cosmos";

/**
 * A reminder somebody created on purpose.
 *
 * Distinct from a follow-up, which is derived from a lead's followUpDate (see
 * leads/followups). This one has its own time, its own text, and delivers
 * itself: an in-app notification, an email, or both.
 *
 * `status` is also the dispatcher's lease. Only a row still at "scheduled" can
 * be claimed, and claiming flips it to "sending" before anything is sent - so
 * two replicas racing the same due reminder cannot both mail it.
 */
export type ReminderStatus = "scheduled" | "sending" | "sent" | "failed" | "cancelled" | "done";

export interface ReminderChannels {
  inApp: boolean;
  email: boolean;
}

export interface Reminder {
  id: string;
  /** Who it is for. Delivery and visibility both key off this. */
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  title: string;
  /** The discussion or topic it is about, in the user's words. */
  topic: string | null;
  notes: string | null;
  /** Optional CRM anchor. With it, the email carries the lead's full context. */
  brandId: string | null;
  brandName: string | null;
  /** When to deliver. Past or now means deliver on the next dispatch. */
  dueAt: string;
  channels: ReminderChannels;
  /** Minutes to block in the recipient's calendar via an .ics attachment. */
  holdMinutes: number | null;
  status: ReminderStatus;
  /** Raised on every re-send of the same calendar UID, or clients ignore the update. */
  sequence: number;
  sentAt: string | null;
  error: string | null;
  attempts: number;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderStore {
  listForUser(userId: string, limit?: number): Promise<Reminder[]>;
  /** Everything owed delivery, across all users - the dispatcher's input. */
  listDue(now: string, limit?: number): Promise<Reminder[]>;
  get(id: string): Promise<Reminder | null>;
  create(r: Reminder): Promise<Reminder>;
  update(r: Reminder): Promise<Reminder>;
  remove(id: string): Promise<void>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "reminders.json");

class LocalReminderStore implements ReminderStore {
  private async readAll(): Promise<Reminder[]> {
    try {
      return JSON.parse(await fs.readFile(FILE, "utf8")) as Reminder[];
    } catch {
      return [];
    }
  }
  private async writeAll(rows: Reminder[]): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(rows, null, 2), "utf8");
  }
  async listForUser(userId: string, limit = 200): Promise<Reminder[]> {
    return (await this.readAll())
      .filter((r) => r.ownerId === userId)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
      .slice(0, limit);
  }
  async listDue(now: string, limit = 50): Promise<Reminder[]> {
    return (await this.readAll())
      .filter((r) => r.status === "scheduled" && r.dueAt <= now)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
      .slice(0, limit);
  }
  async get(id: string): Promise<Reminder | null> {
    return (await this.readAll()).find((r) => r.id === id) ?? null;
  }
  async create(r: Reminder): Promise<Reminder> {
    const all = await this.readAll();
    all.push(r);
    await this.writeAll(all);
    return r;
  }
  async update(r: Reminder): Promise<Reminder> {
    const all = await this.readAll();
    const i = all.findIndex((x) => x.id === r.id);
    if (i >= 0) all[i] = r;
    else all.push(r);
    await this.writeAll(all);
    return r;
  }
  async remove(id: string): Promise<void> {
    await this.writeAll((await this.readAll()).filter((r) => r.id !== id));
  }
}

class CosmosReminderStore implements ReminderStore {
  private container() {
    const db = getCosmosDb();
    if (!db) throw new Error("Cosmos DB is not configured");
    return db.container("reminders");
  }
  async listForUser(userId: string, limit = 200): Promise<Reminder[]> {
    const { resources } = await this.container()
      .items.query<Reminder>({
        query: "SELECT * FROM c WHERE c.ownerId = @u ORDER BY c.dueAt ASC OFFSET 0 LIMIT @n",
        parameters: [
          { name: "@u", value: userId },
          { name: "@n", value: limit },
        ],
      })
      .fetchAll();
    return resources;
  }
  async listDue(now: string, limit = 50): Promise<Reminder[]> {
    // Cross-partition on purpose: the dispatcher works for everybody.
    const { resources } = await this.container()
      .items.query<Reminder>({
        query:
          "SELECT * FROM c WHERE c.status = 'scheduled' AND c.dueAt <= @now ORDER BY c.dueAt ASC OFFSET 0 LIMIT @n",
        parameters: [
          { name: "@now", value: now },
          { name: "@n", value: limit },
        ],
      })
      .fetchAll();
    return resources;
  }
  async get(id: string): Promise<Reminder | null> {
    const { resources } = await this.container()
      .items.query<Reminder>({
        query: "SELECT * FROM c WHERE c.id = @id OFFSET 0 LIMIT 1",
        parameters: [{ name: "@id", value: id }],
      })
      .fetchAll();
    return resources[0] ?? null;
  }
  async create(r: Reminder): Promise<Reminder> {
    const { resource } = await this.container().items.create<Reminder>(r);
    return (resource as Reminder) ?? r;
  }
  async update(r: Reminder): Promise<Reminder> {
    const { resource } = await this.container().items.upsert<Reminder>(r);
    return (resource as Reminder) ?? r;
  }
  async remove(id: string): Promise<void> {
    const existing = await this.get(id);
    if (existing) await this.container().item(id, existing.ownerId).delete();
  }
}

let store: ReminderStore | undefined;

export function getReminderStore(): ReminderStore {
  if (store) return store;
  store = isCosmosConfigured() ? new CosmosReminderStore() : new LocalReminderStore();
  return store;
}
