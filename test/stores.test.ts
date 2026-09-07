import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Brand } from "@/lib/types";

// The file stores compute `.data/` from process.cwd() at import time, so we
// chdir into a throwaway dir before importing them, then restore afterwards.
let cwd0: string;
let tmp: string;
let brandsMod: typeof import("@/lib/store/brands");
let agentsMod: typeof import("@/lib/store/agents");
let usersMod: typeof import("@/lib/store/users");

beforeAll(async () => {
  cwd0 = process.cwd();
  tmp = mkdtempSync(path.join(os.tmpdir(), "oovie-store-"));
  process.chdir(tmp);
  brandsMod = await import("@/lib/store/brands");
  agentsMod = await import("@/lib/store/agents");
  usersMod = await import("@/lib/store/users");
});

afterAll(() => {
  process.chdir(cwd0);
  rmSync(tmp, { recursive: true, force: true });
});

function newBrand(id: string): Brand {
  return {
    id, name: id.toUpperCase(), aliases: [], scored: false,
    status: null, priority: null, owner: null, poc: null, email: null, industry: null, industryRaw: null,
    initialContact: null, lastContact: null, followUpDate: null, closingFailed: null, notes: null,
  };
}

describe("brand store (file)", () => {
  it("seeds 64 brands from the ETL snapshot on first read", async () => {
    expect(await brandsMod.getBrandStore().list()).toHaveLength(64);
  });

  it("updates an existing brand", async () => {
    const store = brandsMod.getBrandStore();
    const first = (await store.list())[0];
    await store.save({ ...first, notes: "edited in test" });
    expect((await store.get(first.id))!.notes).toBe("edited in test");
  });

  it("inserts then removes a brand", async () => {
    const store = brandsMod.getBrandStore();
    await store.save(newBrand("zzz-test"));
    expect(await store.get("zzz-test")).not.toBeNull();
    const n = (await store.list()).length;
    await store.remove("zzz-test");
    expect((await store.list()).length).toBe(n - 1);
    expect(await store.get("zzz-test")).toBeNull();
  });
});

describe("agent store (file)", () => {
  it("seeds 13 agents on first read", async () => {
    expect(await agentsMod.getAgentStore().list()).toHaveLength(13);
  });

  it("round-trips an agent", async () => {
    const store = agentsMod.getAgentStore();
    await store.save({
      id: "a-test", name: "Test Agency", status: null, priority: null, owner: null,
      poc: null, initialContact: null, lastContact: null, followUp: null, notes: "n",
    });
    expect((await store.get("a-test"))!.name).toBe("Test Agency");
    await store.remove("a-test");
    expect(await store.get("a-test")).toBeNull();
  });
});

describe("user store (file)", () => {
  it("creates a user, lowercases the email, and finds it", async () => {
    const store = usersMod.getUserStore();
    expect(await store.findByEmail("nobody@x.com")).toBeNull();
    const u = await store.create({ email: "Test@OOVIE.com", name: "T", passwordHash: "h" });
    expect(u.email).toBe("test@oovie.com");
    expect((await store.findByEmail("test@oovie.com"))!.id).toBe(u.id);
  });
});

describe("brand legacy-key normalisation", () => {
  it("carries a pre-rename followUp across to followUpDate", async () => {
    const { normaliseBrand } = await import("@/lib/store/brands");
    const legacy = { id: "x", name: "X", followUp: "2026-09-01" } as unknown as Brand;
    const fixed = normaliseBrand(legacy);
    expect(fixed.followUpDate).toBe("2026-09-01");
    // Dropped, so the next save heals the record rather than keeping both.
    expect("followUp" in fixed).toBe(false);
  });

  it("does not overwrite a value already written under the new key", async () => {
    const { normaliseBrand } = await import("@/lib/store/brands");
    const both = { id: "x", name: "X", followUp: "2026-01-01", followUpDate: "2026-09-01" } as unknown as Brand;
    expect(normaliseBrand(both).followUpDate).toBe("2026-09-01");
  });

  it("leaves an already-migrated record untouched", async () => {
    const { normaliseBrand } = await import("@/lib/store/brands");
    const current = { id: "x", name: "X", followUpDate: "2026-09-01" } as unknown as Brand;
    expect(normaliseBrand(current)).toBe(current);
  });

  it("turns a legacy null into an explicit null rather than dropping the field", async () => {
    const { normaliseBrand } = await import("@/lib/store/brands");
    const legacy = { id: "x", name: "X", followUp: null } as unknown as Brand;
    expect(normaliseBrand(legacy).followUpDate).toBeNull();
  });

  // Hot/Warm/Cold Lead became High/Medium/Low. The rows in Cosmos still say the
  // old thing, and nothing rewrites them until someone saves that lead, so a
  // read that does not translate shows a blank priority on live data.
  it("translates the retired priority vocabulary", async () => {
    const { normaliseBrand } = await import("@/lib/store/brands");
    const read = (priority: string) =>
      normaliseBrand({ id: "x", name: "X", priority } as unknown as Brand).priority;
    expect(read("Hot Lead")).toBe("High");
    expect(read("Warm Lead")).toBe("Medium");
    expect(read("Cold Lead")).toBe("Low");
  });

  it("passes today's priorities through and drops values that are neither", async () => {
    const { normaliseBrand } = await import("@/lib/store/brands");
    const read = (priority: string) =>
      normaliseBrand({ id: "x", name: "X", priority } as unknown as Brand).priority;
    expect(read("High")).toBe("High");
    expect(read("Low")).toBe("Low");
    // Not a priority in either vocabulary - better blank than a value the
    // select cannot render and the enum will reject on the next save.
    expect(read("Lukewarm")).toBeNull();
  });
});
