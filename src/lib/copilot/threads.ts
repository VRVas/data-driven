import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getCosmosDb, isCosmosConfigured } from "@/lib/store/cosmos";
import type { Block } from "./blocks";

export interface StoredMessage {
  role: "user" | "assistant";
  text?: string | null;
  blocks?: Block[] | null;
  at: string;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredMessage[];
}

/** Lightweight header for the recent-conversations list. */
export interface ConversationHeader {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationStore {
  listForUser(userId: string, limit?: number): Promise<ConversationHeader[]>;
  get(id: string, userId: string): Promise<Conversation | null>;
  create(userId: string, title: string): Promise<Conversation>;
  appendTurn(id: string, userId: string, userText: string, assistantBlocks: Block[]): Promise<void>;
  remove(id: string, userId: string): Promise<void>;
}

function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 48 ? `${t.slice(0, 47)}…` : t || "New chat";
}

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "conversations.json");

class LocalConversationStore implements ConversationStore {
  private async readAll(): Promise<Conversation[]> {
    try {
      return JSON.parse(await fs.readFile(FILE, "utf8")) as Conversation[];
    } catch {
      return [];
    }
  }
  private async writeAll(rows: Conversation[]): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(rows, null, 2), "utf8");
  }
  async listForUser(userId: string, limit = 20): Promise<ConversationHeader[]> {
    return (await this.readAll())
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, messageCount: c.messages.length }));
  }
  async get(id: string, userId: string): Promise<Conversation | null> {
    return (await this.readAll()).find((c) => c.id === id && c.userId === userId) ?? null;
  }
  async create(userId: string, title: string): Promise<Conversation> {
    const now = new Date().toISOString();
    const conv: Conversation = { id: randomUUID(), userId, title: titleFrom(title), createdAt: now, updatedAt: now, messages: [] };
    const all = await this.readAll();
    all.push(conv);
    await this.writeAll(all);
    return conv;
  }
  async appendTurn(id: string, userId: string, userText: string, assistantBlocks: Block[]): Promise<void> {
    const all = await this.readAll();
    const conv = all.find((c) => c.id === id && c.userId === userId);
    if (!conv) return;
    const now = new Date().toISOString();
    conv.messages.push({ role: "user", text: userText, at: now });
    conv.messages.push({ role: "assistant", blocks: assistantBlocks, at: now });
    conv.updatedAt = now;
    await this.writeAll(all);
  }
  async remove(id: string, userId: string): Promise<void> {
    await this.writeAll((await this.readAll()).filter((c) => !(c.id === id && c.userId === userId)));
  }
}

class CosmosConversationStore implements ConversationStore {
  private container() {
    const db = getCosmosDb();
    if (!db) throw new Error("Cosmos DB is not configured");
    return db.container("conversations");
  }
  async listForUser(userId: string, limit = 20): Promise<ConversationHeader[]> {
    const { resources } = await this.container()
      .items.query<Conversation>({
        query: "SELECT * FROM c WHERE c.userId = @u ORDER BY c.updatedAt DESC OFFSET 0 LIMIT @n",
        parameters: [
          { name: "@u", value: userId },
          { name: "@n", value: limit },
        ],
      })
      .fetchAll();
    return resources.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, messageCount: c.messages.length }));
  }
  async get(id: string, userId: string): Promise<Conversation | null> {
    try {
      const { resource } = await this.container().item(id, userId).read<Conversation>();
      return resource ?? null;
    } catch {
      return null;
    }
  }
  async create(userId: string, title: string): Promise<Conversation> {
    const now = new Date().toISOString();
    const conv: Conversation = { id: randomUUID(), userId, title: titleFrom(title), createdAt: now, updatedAt: now, messages: [] };
    await this.container().items.create<Conversation>(conv);
    return conv;
  }
  async appendTurn(id: string, userId: string, userText: string, assistantBlocks: Block[]): Promise<void> {
    const conv = await this.get(id, userId);
    if (!conv) return;
    const now = new Date().toISOString();
    conv.messages.push({ role: "user", text: userText, at: now });
    conv.messages.push({ role: "assistant", blocks: assistantBlocks, at: now });
    conv.updatedAt = now;
    await this.container().items.upsert<Conversation>(conv);
  }
  async remove(id: string, userId: string): Promise<void> {
    await this.container().item(id, userId).delete();
  }
}

let store: ConversationStore | undefined;

export function getConversationStore(): ConversationStore {
  if (store) return store;
  store = isCosmosConfigured() ? new CosmosConversationStore() : new LocalConversationStore();
  return store;
}
