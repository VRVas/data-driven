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
    status: null, priority: null, owner: null, poc: null, industry: null, industryRaw: null,
    initialContact: null, lastContact: null, followUp: null, closingFailed: null, notes: null,
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
