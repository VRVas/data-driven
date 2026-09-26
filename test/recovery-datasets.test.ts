import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emptyContainer, readDataset, writeDataset, verifyDataset } from "@/lib/recovery/datasets";
import { prepareImport } from "@/lib/recovery/policy";
import { hashPassword } from "@/lib/auth/password";
import type { BackupContainer } from "@/lib/recovery/package";
import * as backend from "@/lib/recovery/backend";

const management = vi.hoisted(() => ({ storedProcedures: vi.fn(), triggers: vi.fn(), userDefinedFunctions: vi.fn() }));
vi.mock("@azure/arm-cosmosdb", () => ({ CosmosDBManagementClient: class {
  sqlResources = { listSqlStoredProcedures: management.storedProcedures, listSqlTriggers: management.triggers, listSqlUserDefinedFunctions: management.userDefinedFunctions };
} }));

let directory: string;
let cwd: string;
beforeEach(async () => { cwd = process.cwd(); directory = await mkdtemp(path.join(os.tmpdir(), "recovery-data-")); process.chdir(directory); vi.stubEnv("COSMOS_ENDPOINT", "");
  vi.stubEnv("COSMOS_RESOURCE_ID", "/subscriptions/fixture/resourceGroups/fixture-group/providers/Microsoft.DocumentDB/databaseAccounts/fixture");
  for (const list of Object.values(management)) list.mockReset().mockImplementation(async function* () {});
});
afterEach(async () => { vi.restoreAllMocks(); process.chdir(cwd); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
async function fixture(): Promise<BackupContainer[]> {
  return [{ ...emptyContainer("users"), items: [{ id: "admin", email: "admin@example.invalid", name: "Fixture Admin", role: "admin", passwordHash: await hashPassword("Fixture12345!") }] },
    { ...emptyContainer("brands"), items: [{ id: "lead", name: "Fixture Lead", owner: "Fixture Admin" }] },
    { ...emptyContainer("notes"), items: [{ id: "note", leadId: "lead", body: "Fixture" }] }];
}
describe("staged datasets and import policy", () => {
  it("reads complete script inventories through ARM when the data plane rejects Entra script reads", async () => {
    vi.stubEnv("COSMOS_ENDPOINT", "https://fixture.documents.azure.com");
    vi.stubEnv("COSMOS_RESOURCE_ID", "/subscriptions/fixture/resourceGroups/fixture-group/providers/Microsoft.DocumentDB/databaseAccounts/fixture");
    const storedProcedures = [{ id: "fixture-procedure", body: "function () { return 1; }", rid: "fixture-rid", etag: "fixture-etag", ts: 123 },
      { id: "fixture-next-page", body: "function () { return 3; }" }];
    const triggers = [{ id: "fixture-trigger", body: "function () {}", triggerType: "Pre", triggerOperation: "All" }];
    const userDefinedFunctions = [{ id: "fixture-udf", body: "function () { return 2; }" }];
    const entries = async function* (resources: Record<string, unknown>[]) { for (const resource of resources) yield { id: "arm-resource-id", resource }; };
    management.storedProcedures.mockImplementation(() => entries(storedProcedures));
    management.triggers.mockImplementation(() => entries(triggers));
    management.userDefinedFunctions.mockImplementation(() => entries(userDefinedFunctions));
    const forbidden = vi.fn().mockRejectedValue(Object.assign(new Error("Non-data operation cannot use Entra on the data plane"), { code: 403, substatus: 5300 }));
    const scripts = { readAll: () => ({ fetchAll: forbidden }) };
    const database = {
      containers: { readAll: () => ({ fetchAll: async () => ({ resources: [emptyContainer("profiles").definition] }) }) },
      container: () => ({
        items: { readAll: () => ({ hasMoreResults: vi.fn().mockReturnValueOnce(true).mockReturnValue(false), fetchNext: async () => ({ resources: [] }) }) },
        scripts: { storedProcedures: scripts, triggers: scripts, userDefinedFunctions: scripts },
      }),
    };
    vi.spyOn(backend, "rawDatabase").mockReturnValue(database as unknown as NonNullable<ReturnType<typeof backend.rawDatabase>>);
    const target = "restore-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const result = await readDataset(target);
    expect(forbidden).not.toHaveBeenCalled();
    expect(result[0].scripts.storedProcedures).toEqual([{ id: storedProcedures[0].id, body: storedProcedures[0].body, _rid: "fixture-rid", _etag: "fixture-etag", _ts: 123 }, storedProcedures[1]]);
    expect(result[0].scripts.triggers).toEqual(triggers);
    expect(result[0].scripts.userDefinedFunctions).toEqual(userDefinedFunctions);
    for (const list of Object.values(management)) expect(list).toHaveBeenCalledWith("fixture-group", "fixture", target, "profiles");
    expect(() => prepareImport(result, "full", [])).toThrow("Executable database scripts require a reviewed operator migration");
  });

  it.each([undefined, { id: "missing-body" }, { body: "function () {}" }])("rejects an incomplete ARM script entry instead of claiming an empty inventory: %j", async (resource) => {
    vi.stubEnv("COSMOS_ENDPOINT", "https://fixture.documents.azure.com");
    management.storedProcedures.mockImplementation(async function* () { yield { resource }; });
    const database = {
      containers: { readAll: () => ({ fetchAll: async () => ({ resources: [emptyContainer("profiles").definition] }) }) },
      container: () => ({ items: { readAll: () => ({ hasMoreResults: () => false }) } }),
    };
    vi.spyOn(backend, "rawDatabase").mockReturnValue(database as unknown as NonNullable<ReturnType<typeof backend.rawDatabase>>);
    await expect(readDataset("restore-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).rejects.toMatchObject({ code: "invalid_script_inventory" });
    expect(management.triggers).not.toHaveBeenCalled();
  });

  it("accepts a result-less terminal Cosmos page without losing the preceding documents", async () => {
    vi.stubEnv("COSMOS_ENDPOINT", "https://fixture.documents.azure.com");
    const agent = { id: "fixture-agent", name: "Fixture Agent" };
    const fetchNext = vi.fn().mockResolvedValueOnce({ resources: [agent] }).mockResolvedValueOnce({ resources: undefined });
    const emptyScripts = { readAll: () => ({ fetchAll: async () => ({ resources: [] }) }) };
    const database = {
      containers: { readAll: () => ({ fetchAll: async () => ({ resources: [emptyContainer("agents").definition] }) }) },
      container: () => ({
        items: { readAll: () => ({ hasMoreResults: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false), fetchNext }) },
        scripts: { storedProcedures: emptyScripts, triggers: emptyScripts, userDefinedFunctions: emptyScripts },
      }),
    };
    vi.spyOn(backend, "rawDatabase").mockReturnValue(database as unknown as NonNullable<ReturnType<typeof backend.rawDatabase>>);
    const result = await readDataset("restore-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(result[0].items).toEqual([agent]);
    expect(fetchNext).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["documents", "Reading documents from agents"],
    ["storedProcedures", "Reading stored procedures from agents"],
    ["triggers", "Reading triggers from agents"],
    ["userDefinedFunctions", "Reading user-defined functions from agents"],
  ])("identifies a Cosmos failure while reading %s without swallowing it", async (stage, label) => {
    vi.stubEnv("COSMOS_ENDPOINT", "https://fixture.documents.azure.com");
    const failure = Object.assign(new Error("fixture read failure"), { code: 403 });
    for (const [name, list] of Object.entries(management)) list.mockImplementation(async function* () { if (name === stage) throw failure; });
    const fetchStage = (name: string) => name === stage ? vi.fn().mockRejectedValue(failure) : vi.fn().mockResolvedValue({ resources: [] });
    const readAll = (name: string) => ({ readAll: () => ({ fetchAll: fetchStage(name) }) });
    const database = {
      containers: { readAll: () => ({ fetchAll: async () => ({ resources: [emptyContainer("agents").definition] }) }) },
      container: () => ({
        items: { readAll: () => ({ hasMoreResults: vi.fn().mockReturnValueOnce(true).mockReturnValue(false), fetchNext: fetchStage("documents") }) },
        scripts: { storedProcedures: readAll("storedProcedures"), triggers: readAll("triggers"), userDefinedFunctions: readAll("userDefinedFunctions") },
      }),
    };
    vi.spyOn(backend, "rawDatabase").mockReturnValue(database as unknown as NonNullable<ReturnType<typeof backend.rawDatabase>>);
    const progress = vi.fn(async (_label: string) => undefined);
    await expect(readDataset("restore-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", progress)).rejects.toBe(failure);
    expect(progress).toHaveBeenLastCalledWith(label);
  });

  it("writes and verifies a staged dataset without touching the original", async () => {
    const source = await fixture();
    const prepared = prepareImport(source, "full", []);
    const target = "restore-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await writeDataset(target, prepared.containers);
    await expect(verifyDataset(target, prepared.containers)).resolves.toBeUndefined();
    expect((await readDataset("bd")).every((container) => container.items.length === 0)).toBe(true);
    await expect(writeDataset("bd", prepared.containers)).rejects.toMatchObject({ code: "unsafe_target" });
  });
  it("never reactivates challenges, integration work, file references or pending sends", async () => {
    const source = await fixture();
    for (const name of ["authChallenges", "copilotIntegrations", "documents", "reminders", "outreach"]) source.push({ ...emptyContainer(name), items: [{ id: "old", status: "scheduled" }] });
    const result = prepareImport(source, "full", []);
    for (const name of ["authChallenges", "copilotIntegrations", "documents"]) expect(result.containers.find((container) => container.definition.id === name)!.items).toEqual([]);
    expect(result.containers.find((container) => container.definition.id === "reminders")!.items[0].status).toBe("cancelled");
    expect(result.changes.length).toBe(5);
  });
  it("rejects orphan lead references and administrator lockout", async () => {
    const source = await fixture();
    source.find((container) => container.definition.id === "notes")!.items[0].leadId = "missing";
    expect(() => prepareImport(source, "full", [])).toThrow("absent from the package");
    expect(() => prepareImport([emptyContainer("brands")], "full", [])).toThrow("administrator");
  });
  it("keeps current users and audit in a CRM-only reset", async () => {
    const source = await fixture();
    const current = await fixture();
    current[0].items[0].name = "Current Admin";
    const result = prepareImport(source, "crm", current);
    expect(result.containers.find((container) => container.definition.id === "users")!.items[0].name).toBe("Current Admin");
    expect(result.containers.find((container) => container.definition.id === "notes")!.items[0].id).toBe("note");
  });
});