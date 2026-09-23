import "server-only";
import { dataFs as fs } from "@/lib/recovery/routing";
import path from "node:path";
import { dataDirectory } from "./location";
import { randomUUID } from "node:crypto";
import { writeJsonAtomic } from "./local-json";
import { getCosmosDb, isCosmosConfigured } from "./cosmos";
import {
  expiryFor,
  hashSecret,
  isUsable,
  MAX_ATTEMPTS,
  secretMatches,
  type Challenge,
  type ChallengeKind,
} from "@/lib/auth/challenge";

export interface ChallengeStore {
  issue(email: string, kind: ChallengeKind, secret: string): Promise<Challenge>;
  recent(email: string, kind: ChallengeKind): Promise<Challenge[]>;
  /** Verifies, counts the attempt, and burns the challenge on success. */
  redeem(email: string, kind: ChallengeKind, supplied: string): Promise<{ ok: boolean; reason?: string }>;
  /** Called after a password change - any outstanding link must stop working. */
  revokeAll(email: string): Promise<void>;
}

const norm = (email: string) => email.trim().toLowerCase();

/**
 * Shared verification, so the file and Cosmos stores cannot drift on the part
 * that matters. Attempts are counted BEFORE the comparison: a crash or a
 * dropped connection mid-verify must not hand back a free guess.
 */
async function redeemAgainst(
  candidates: Challenge[],
  supplied: string,
  save: (c: Challenge) => Promise<void>,
): Promise<{ ok: boolean; reason?: string }> {
  const live = candidates.filter((c) => isUsable(c)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (live.length === 0) return { ok: false, reason: "That code has expired or was already used. Request a new one." };

  // Only the newest is valid; issuing a new code must invalidate the old one.
  const current = live[0];
  current.attempts += 1;
  await save(current);

  if (!(await secretMatches(supplied, current.secretHash))) {
    const left = MAX_ATTEMPTS - current.attempts;
    return { ok: false, reason: left > 0 ? `That code is not right. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong attempts. Request a new code." };
  }

  current.consumedAt = new Date().toISOString();
  await save(current);
  return { ok: true };
}

const DATA_DIR = dataDirectory();
const FILE = path.join(DATA_DIR, "challenges.json");

class LocalChallengeStore implements ChallengeStore {
  private async all(): Promise<Challenge[]> {
    try {
      return JSON.parse(await fs.readFile(FILE, "utf8")) as Challenge[];
    } catch {
      return [];
    }
  }

  private async write(rows: Challenge[]): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    // Expired rows are noise, not history - drop them on every write.
    const keep = rows.filter((c) => Date.parse(c.expiresAt) > Date.now() - 86_400_000);
    await writeJsonAtomic(FILE, keep);
  }

  async issue(email: string, kind: ChallengeKind, secret: string): Promise<Challenge> {
    const rows = await this.all();
    const e = norm(email);
    const row: Challenge = {
      id: randomUUID(),
      email: e,
      kind,
      secretHash: await hashSecret(secret),
      createdAt: new Date().toISOString(),
      expiresAt: expiryFor(kind),
      attempts: 0,
      consumedAt: null,
    };
    // Supersede anything outstanding of the same kind.
    for (const c of rows) if (c.email === e && c.kind === kind && !c.consumedAt) c.consumedAt = row.createdAt;
    rows.push(row);
    await this.write(rows);
    return row;
  }

  async recent(email: string, kind: ChallengeKind): Promise<Challenge[]> {
    const e = norm(email);
    return (await this.all()).filter((c) => c.email === e && c.kind === kind);
  }

  async redeem(email: string, kind: ChallengeKind, supplied: string) {
    const rows = await this.all();
    const e = norm(email);
    return redeemAgainst(
      rows.filter((c) => c.email === e && c.kind === kind),
      supplied,
      async () => this.write(rows),
    );
  }

  async revokeAll(email: string): Promise<void> {
    const rows = await this.all();
    const e = norm(email);
    const now = new Date().toISOString();
    for (const c of rows) if (c.email === e && !c.consumedAt) c.consumedAt = now;
    await this.write(rows);
  }
}

class CosmosChallengeStore implements ChallengeStore {
  private container() {
    const db = getCosmosDb();
    if (!db) throw new Error("Cosmos DB is not configured");
    return db.container("authChallenges");
  }

  private async forEmail(email: string, kind: ChallengeKind): Promise<Challenge[]> {
    const { resources } = await this.container()
      .items.query<Challenge>({
        query: "SELECT * FROM c WHERE c.email = @e AND c.kind = @k",
        parameters: [
          { name: "@e", value: norm(email) },
          { name: "@k", value: kind },
        ],
      })
      .fetchAll();
    return resources;
  }

  async issue(email: string, kind: ChallengeKind, secret: string): Promise<Challenge> {
    const e = norm(email);
    for (const c of await this.forEmail(e, kind)) {
      if (!c.consumedAt) await this.container().items.upsert({ ...c, consumedAt: new Date().toISOString() });
    }
    const row: Challenge = {
      id: randomUUID(),
      email: e,
      kind,
      secretHash: await hashSecret(secret),
      createdAt: new Date().toISOString(),
      expiresAt: expiryFor(kind),
      attempts: 0,
      consumedAt: null,
    };
    // ttl lets Cosmos delete the row itself once it can no longer be used.
    await this.container().items.create({ ...row, ttl: 60 * 60 * 24 });
    return row;
  }

  async recent(email: string, kind: ChallengeKind): Promise<Challenge[]> {
    return this.forEmail(email, kind);
  }

  async redeem(email: string, kind: ChallengeKind, supplied: string) {
    const rows = await this.forEmail(email, kind);
    return redeemAgainst(rows, supplied, async (c) => {
      await this.container().items.upsert(c);
    });
  }

  async revokeAll(email: string): Promise<void> {
    const now = new Date().toISOString();
    for (const kind of ["otp", "reset"] as ChallengeKind[]) {
      for (const c of await this.forEmail(email, kind)) {
        if (!c.consumedAt) await this.container().items.upsert({ ...c, consumedAt: now });
      }
    }
  }
}

let cached: ChallengeStore | null = null;

export function getChallengeStore(): ChallengeStore {
  if (cached) return cached;
  cached = isCosmosConfigured() ? new CosmosChallengeStore() : new LocalChallengeStore();
  return cached;
}
