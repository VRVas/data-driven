import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CosmosClient, type Database } from "@azure/cosmos";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CosmosIntegrationStore, LocalIntegrationStore, documentBase } from "@/lib/copilot/external/store";

const mocks = vi.hoisted(() => ({ database: vi.fn() }));
vi.mock("@/lib/store/cosmos", () => ({ getCosmosDb: mocks.database }));

const directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "copilot-integration-"));
  directories.push(directory);
  return new LocalIntegrationStore(path.join(directory, "records.json"));
}
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("durable integration records", () => {
  it("shares local locks across independently loaded server bundles", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "copilot-bundles-"));
    directories.push(directory);
    const file = path.join(directory, "records.json");
    const first = new LocalIntegrationStore(file);
    vi.resetModules();
    const { LocalIntegrationStore: OtherBundleStore } = await import("@/lib/copilot/external/store");
    const second = new OtherBundleStore(file);
    await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).create(documentBase("task", "fixture", `request-${index}`))));
    expect(await first.scan("task")).toHaveLength(20);
  });

  it("creates an idempotent key once even under contention", async () => {
    const store = await fixture();
    const record = documentBase("task", "client-a", "request-1");
    const writes = await Promise.all(Array.from({ length: 10 }, () => store.create(record)));
    expect(writes.filter(Boolean)).toHaveLength(1);
  });

  it("accepts only one competing lease update", async () => {
    const store = await fixture();
    const record = (await store.create(documentBase("task", "client-a", "request-1")))!;
    const writes = await Promise.all(Array.from({ length: 10 }, () => store.replace(record, record._etag!)));
    expect(writes.filter(Boolean)).toHaveLength(1);
  });

  it("isolates records and filtered scans by caller partition", async () => {
    const store = await fixture();
    await store.create({ ...documentBase("task", "client-a", "request-1"), state: "queued" });
    await store.create({ ...documentBase("task", "client-b", "request-1"), state: "completed" });
    expect(await store.get("client-c", "request-1")).toBeNull();
    expect(await store.scan("task", { partitionKey: "client-a", states: ["queued"] })).toHaveLength(1);
    expect(await store.scan("task", { partitionKey: "client-a", states: ["completed"] })).toEqual([]);
  });

  it("expires temporary records and lists recent tasks before applying the limit", async () => {
    const store = await fixture();
    await store.create({ ...documentBase("task", "client-a", "old"), createdAt: "2020-01-01T00:00:00.000Z" });
    await store.create({ ...documentBase("task", "client-a", "new"), createdAt: "2021-01-01T00:00:00.000Z" });
    await store.create({ ...documentBase("task", "client-a", "expired"), updatedAt: "2000-01-01T00:00:00.000Z", ttl: 1 });
    await store.create({ ...documentBase("link", "client-a", "permanent"), updatedAt: "2000-01-01T00:00:00.000Z", ttl: -1 });
    expect(await store.get("client-a", "expired")).toBeNull();
    expect(await store.get("client-a", "permanent")).not.toBeNull();
    expect((await store.scan("task", { newestFirst: true, limit: 1 }))[0].id).toBe("new");
  });
});

describe("Cosmos integration store SDK contract", () => {
  const read = vi.fn();
  const replace = vi.fn();
  const create = vi.fn();
  const fetchAll = vi.fn();
  const query = vi.fn(() => ({ fetchAll }));
  const item = vi.fn(() => ({ read, replace }));
  const container = vi.fn(() => ({ item, items: { create, query } }));
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.database.mockReturnValue({ container });
  });

  it("uses partitioned point reads and only suppresses missing records", async () => {
    const store = new CosmosIntegrationStore();
    read.mockResolvedValueOnce({ resource: documentBase("task", "owner", "task") });
    expect((await store.get("owner", "task"))?.partitionKey).toBe("owner");
    expect(container).toHaveBeenCalledWith("copilotIntegrations");
    expect(item).toHaveBeenCalledWith("task", "owner");
    read.mockRejectedValueOnce({ code: 404 }).mockRejectedValueOnce({ code: 503 });
    expect(await store.get("owner", "missing")).toBeNull();
    await expect(store.get("owner", "unavailable")).rejects.toMatchObject({ code: 503 });
  });

  it("uses create-only IDs and IfMatch ETags without hiding database failures", async () => {
    const store = new CosmosIntegrationStore();
    const record = { ...documentBase("task", "owner", "task"), _etag: "original-version" };
    create.mockRejectedValueOnce({ code: 409 });
    expect(await store.create(record)).toBeNull();
    replace.mockResolvedValueOnce({ resource: { ...record, _etag: "new-version" } });
    expect((await store.replace(record, record._etag))?._etag).toBe("new-version");
    expect(replace).toHaveBeenCalledWith(expect.objectContaining({ id: "task", partitionKey: "owner" }), { accessCondition: { type: "IfMatch", condition: "original-version" } });
    replace.mockRejectedValueOnce({ code: 412 }).mockRejectedValueOnce({ code: 404 }).mockRejectedValueOnce({ code: 429 });
    expect(await store.replace(record, "stale")).toBeNull();
    expect(await store.replace(record, "deleted")).toBeNull();
    await expect(store.replace(record, "throttled")).rejects.toMatchObject({ code: 429 });
  });

  it("parameterizes filters, targets the owner partition, and bounds ordered scans", async () => {
    fetchAll.mockResolvedValue({ resources: [] });
    const store = new CosmosIntegrationStore();
    await store.scan("task", { partitionKey: "owner", states: ["completed"], undelivered: true, newestFirst: true, limit: 9999 });
    expect(query).toHaveBeenCalledWith({
      query: "SELECT TOP @limit * FROM c WHERE c.kind = @kind AND c.partitionKey = @partition AND ARRAY_CONTAINS(@states, c.state) AND c.deliveryPublished = false ORDER BY c.createdAt DESC",
      parameters: [{ name: "@kind", value: "task" }, { name: "@limit", value: 1000 }, { name: "@partition", value: "owner" }, { name: "@states", value: ["completed"] }],
    }, { partitionKey: "owner" });
  });
});

describe.skipIf(!process.env.COPILOT_COSMOS_EMULATOR_ENDPOINT)("Cosmos integration store against the local emulator", () => {
  let client: CosmosClient | undefined;
  let database: Database | undefined;
  const store = new CosmosIntegrationStore();
  beforeAll(async () => {
    const endpoint = new URL(process.env.COPILOT_COSMOS_EMULATOR_ENDPOINT!);
    if (endpoint.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(endpoint.hostname) || endpoint.username || endpoint.password) throw new Error("Emulator tests require a loopback-only HTTP endpoint.");
    client = new CosmosClient({ endpoint: endpoint.origin, key: "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==" });
    const created = await client.databases.create({ id: `copilot-integration-test-${randomUUID()}` });
    database = created.database;
    await database.containers.create({ id: "copilotIntegrations", partitionKey: { paths: ["/partitionKey"] }, defaultTtl: -1 });
    mocks.database.mockReturnValue(database);
  }, 60000);
  afterAll(async () => {
    try { if (database) await database.delete(); }
    finally { client?.dispose(); }
  }, 30000);

  it("creates one record and grants one conditional lease across competing SDK requests", async () => {
    const record = documentBase("task", "fixture-owner", "contended");
    const creates = await Promise.all(Array.from({ length: 8 }, () => store.create(record)));
    expect(creates.filter(Boolean)).toHaveLength(1);
    const original = (await store.get("fixture-owner", "contended"))!;
    expect(await store.get("another-owner", "contended")).toBeNull();
    const claims = await Promise.all(Array.from({ length: 8 }, () => store.replace({ ...original, leaseOwner: randomUUID() }, original._etag!)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await store.get("fixture-owner", "contended"))?._etag).not.toBe(original._etag);
  }, 30000);

  it("executes filtered partition and cross-partition worker queries", async () => {
    await store.create({ ...documentBase("task", "fixture-owner", "result-a"), state: "completed", deliveryPublished: false, createdAt: "2020-01-01T00:00:00.000Z" });
    await store.create({ ...documentBase("task", "another-owner", "result-b"), state: "completed", deliveryPublished: false, createdAt: "2021-01-01T00:00:00.000Z" });
    expect((await store.scan("task", { partitionKey: "fixture-owner", states: ["completed"], undelivered: true })).map((record) => record.id)).toEqual(["result-a"]);
    expect((await store.scan("task", { states: ["completed"], undelivered: true, newestFirst: true, limit: 1 })).map((record) => record.id)).toEqual(["result-b"]);
    await store.create({ ...documentBase("task", "fixture-owner", "executing-action"), state: "input-required", actions: [{ state: "executing" }] });
    await store.create({ ...documentBase("task", "fixture-owner", "pending-action"), state: "input-required", actions: [{ state: "pending" }] });
    expect((await store.scan("task", { states: ["input-required"], executingActions: true })).map((record) => record.id)).toEqual(["executing-action"]);
  }, 30000);

  it("enables per-item TTL without expiring permanent records", async () => {
    expect((await database!.container("copilotIntegrations").read()).resource?.defaultTtl).toBe(-1);
    await store.create({ ...documentBase("fixture", "fixture-owner", "expires"), ttl: 1 });
    await store.create({ ...documentBase("fixture", "fixture-owner", "permanent"), ttl: -1 });
    await expect.poll(() => store.get("fixture-owner", "expires"), { timeout: 15000 }).toBeNull();
    expect(await store.get("fixture-owner", "permanent")).not.toBeNull();
  }, 20000);
});