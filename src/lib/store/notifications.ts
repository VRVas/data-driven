import "server-only";
import path from "node:path";
import { dataDirectory } from "./location";
import { getCosmosDb, isCosmosConfigured } from "./cosmos";
import { mutateJsonArray, readJsonArray } from "./local-json";

/**
 * In-app notifications - the other half of a reminder's delivery.
 *
 * Kept separate from the reminder itself because they have different
 * lifetimes: a reminder is one record that fires once, a notification is what
 * the recipient sees afterwards and dismisses in their own time. Anything else
 * worth telling a user about can land here later without touching reminders.
 */
export type NotificationKind = "reminder" | "outreach" | "system";

export interface Notification {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Where pressing it goes - a lead page, the outbox, wherever it came from. */
  href: string | null;
  /** The record that produced it, so a duplicate can be recognised. */
  sourceId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationStore {
  listForUser(userId: string, limit?: number): Promise<Notification[]>;
  create(n: Notification): Promise<Notification>;
  markRead(id: string, userId: string): Promise<void>;
  markAllRead(userId: string): Promise<number>;
}

const DATA_DIR = dataDirectory();
const FILE = path.join(DATA_DIR, "notifications.json");

class LocalNotificationStore implements NotificationStore {
  private readAll(): Promise<Notification[]> {
    return readJsonArray<Notification>(FILE);
  }
  async listForUser(userId: string, limit = 50): Promise<Notification[]> {
    return (await this.readAll())
      .filter((n) => n.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  async create(n: Notification): Promise<Notification> {
    await mutateJsonArray<Notification>(FILE, (rows) => [...rows, n]);
    return n;
  }
  async markRead(id: string, userId: string): Promise<void> {
    const now = new Date().toISOString();
    await mutateJsonArray<Notification>(FILE, (rows) =>
      rows.map((n) => (n.id === id && n.userId === userId ? { ...n, readAt: n.readAt ?? now } : n)),
    );
  }
  async markAllRead(userId: string): Promise<number> {
    const now = new Date().toISOString();
    let count = 0;
    await mutateJsonArray<Notification>(FILE, (rows) =>
      rows.map((n) => {
        if (n.userId !== userId || n.readAt) return n;
        count += 1;
        return { ...n, readAt: now };
      }),
    );
    return count;
  }
}

class CosmosNotificationStore implements NotificationStore {
  private container() {
    const db = getCosmosDb();
    if (!db) throw new Error("Cosmos DB is not configured");
    return db.container("notifications");
  }
  async listForUser(userId: string, limit = 50): Promise<Notification[]> {
    const { resources } = await this.container()
      .items.query<Notification>({
        query: "SELECT * FROM c WHERE c.userId = @u ORDER BY c.createdAt DESC OFFSET 0 LIMIT @n",
        parameters: [
          { name: "@u", value: userId },
          { name: "@n", value: limit },
        ],
      })
      .fetchAll();
    return resources;
  }
  async create(n: Notification): Promise<Notification> {
    const { resource } = await this.container().items.create<Notification>(n);
    return (resource as Notification) ?? n;
  }
  async markRead(id: string, userId: string): Promise<void> {
    try {
      const { resource } = await this.container().item(id, userId).read<Notification>();
      if (!resource || resource.readAt) return;
      await this.container().items.upsert<Notification>({ ...resource, readAt: new Date().toISOString() });
    } catch {
      // Gone, or not this user's - either way there is nothing to mark.
    }
  }
  async markAllRead(userId: string): Promise<number> {
    const unread = (await this.listForUser(userId, 200)).filter((n) => !n.readAt);
    const now = new Date().toISOString();
    for (const n of unread) {
      await this.container().items.upsert<Notification>({ ...n, readAt: now });
    }
    return unread.length;
  }
}

let store: NotificationStore | undefined;

export function getNotificationStore(): NotificationStore {
  if (store) return store;
  store = isCosmosConfigured() ? new CosmosNotificationStore() : new LocalNotificationStore();
  return store;
}
