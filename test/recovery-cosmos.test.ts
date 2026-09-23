import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { CosmosClient } from "@azure/cosmos";

const emulator = vi.hoisted(() => ({ client: undefined as CosmosClient | undefined }));
vi.mock("@/lib/recovery/backend", async (original) => ({ ...await original<object>(), rawDatabase: (name: string) => emulator.client?.database(name) ?? null }));
vi.mock("@azure/arm-cosmosdb", () => ({ CosmosDBManagementClient: class {
  sqlResources = {
    beginCreateUpdateSqlDatabaseAndWait: async (_group: string, _account: string, name: string) => emulator.client!.databases.createIfNotExists({ id: name }),
    beginCreateUpdateSqlContainerAndWait: async (_group: string, _account: string, database: string, _name: string, body: { resource: Record<string, unknown> }) =>
      emulator.client!.database(database).containers.createIfNotExists(body.resource as { id: string }),
  };
} }));

import { cancelJob, confirmJob, getRecoveryJob, loadArtifact, previewImport, previewSeed, processRecoveryJob, startBackup } from "@/lib/recovery/jobs";
import { recoveryState } from "@/lib/recovery/control";
import { getCosmosDb } from "@/lib/store/cosmos";
import { readPackage } from "@/lib/recovery/package";
import { readDataset } from "@/lib/recovery/datasets";

describe.skipIf(!process.env.RECOVERY_COSMOS_EMULATOR_ENDPOINT)("recovery over the real Cosmos emulator", () => {
  const base = `recovery-fixture-${randomUUID()}`;
  const databases = new Set<string>([base, `${base}-recovery`]);
  const actor = { id: "fixture-operator", name: "Fixture Operator", email: "", authority: "recovery-key" as const };
  beforeAll(async () => {
    const endpoint = new URL(process.env.RECOVERY_COSMOS_EMULATOR_ENDPOINT!);
    if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(endpoint.hostname)) throw new Error("Only the loopback emulator is permitted.");
    emulator.client = new CosmosClient({ endpoint: endpoint.origin, key: "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==" });
    vi.stubEnv("DATA_RECOVERY_ENABLED", "true"); vi.stubEnv("COSMOS_DATABASE", base); vi.stubEnv("COSMOS_CONTROL_DATABASE", `${base}-recovery`);
    vi.stubEnv("COSMOS_ENDPOINT", "https://fixture.documents.azure.com"); vi.stubEnv("COSMOS_RESOURCE_ID", "/subscriptions/fixture/resourceGroups/fixture/providers/Microsoft.DocumentDB/databaseAccounts/fixture");
    vi.stubEnv("AUTH_SECRET", "recovery-emulator-auth-fixture-00000000000");
    await emulator.client.databases.create({ id: base });
    const control = await emulator.client.databases.create({ id: `${base}-recovery` });
    await control.database.containers.create({ id: "operations", partitionKey: { paths: ["/partitionKey"] }, defaultTtl: -1 });
  }, 60000);
  afterAll(async () => {
    try { for (const name of databases) await emulator.client?.database(name).delete().catch(() => undefined); }
    finally { emulator.client?.dispose(); vi.unstubAllEnvs(); }
  }, 60000);

  it("initializes, backs up, replaces, and routes reads using real ETags and encrypted artifact records", async () => {
    expect((await recoveryState()).mode).toBe("setup");
    const seed = await previewSeed(actor, { name: "Fixture Admin", email: "fixture@example.invalid", password: "Fixture12345!" });
    databases.add(seed.target);
    await confirmJob(seed.id, "INITIALIZE");
    await Promise.all([processRecoveryJob(seed.id), processRecoveryJob(seed.id)]);
    expect((await getRecoveryJob(seed.id)).status).toBe("completed");
    const routed = getCosmosDb()!;
    const seeded = await routed.container("brands").items.readAll().fetchAll();
    expect(seeded.resources.length).toBeGreaterThan(0);
    const backup = await startBackup(actor, "emulator-backup-password");
    await processRecoveryJob(backup.id);
    const saved = await getRecoveryJob(backup.id);
    expect(saved.status).toBe("completed");
    const archive = await loadArtifact(saved.output!);
    const packageData = await readPackage(archive, "emulator-backup-password");
    expect(packageData.containers.find((container) => container.definition.id === "brands")!.items.length).toBe(seeded.resources.length);
    const restore = await previewImport(actor, archive, "emulator-backup-password", "full");
    databases.add(restore.target);
    await confirmJob(restore.id, `REPLACE ${seed.target}`);
    await expect(routed.container("brands").items.readAll().fetchAll()).rejects.toMatchObject({ code: "maintenance" });
    await processRecoveryJob(restore.id);
    expect((await getRecoveryJob(restore.id)).status).toBe("completed");
    expect((await recoveryState()).active).toBe(restore.target);
    expect((await routed.container("brands").items.readAll().fetchAll()).resources.length).toBe(seeded.resources.length);
    expect((await readDataset(seed.target)).length).toBeGreaterThan(0);
    await expect(cancelJob(restore.id)).rejects.toMatchObject({ code: "already_complete" });
  }, 120000);
});