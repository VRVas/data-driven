import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DefaultAzureCredential } from "@azure/identity";
import { CosmosDBManagementClient, type SqlContainerResource } from "@azure/arm-cosmosdb";
import { baselineDatabase, rawDatabase } from "./backend";
import { localTargetDirectory } from "./control";
import { EXPANDED_LIMIT, RecoveryError, canonical, portableDocument, portableHash, type BackupContainer, type Document } from "./package";

export const CONTAINERS: Record<string, { key: string; file: string; ttl?: number }> = {
  brands: { key: "/id", file: "brands.json" }, agents: { key: "/id", file: "agents.json" }, industries: { key: "/name", file: "industries.json" },
  users: { key: "/email", file: "users.json" }, profiles: { key: "/id", file: "profiles.json" }, audit: { key: "/id", file: "audit.json" },
  crm: { key: "/companyId", file: "crm.json" }, notes: { key: "/leadId", file: "notes.json" }, comments: { key: "/recordId", file: "comments.json" },
  reminders: { key: "/ownerId", file: "reminders.json" }, notifications: { key: "/userId", file: "notifications.json" },
  outreach: { key: "/id", file: "outreach.json" }, savedViews: { key: "/userId", file: "views.json" }, conversations: { key: "/userId", file: "conversations.json" },
  documents: { key: "/userId", file: "documents.json" }, authChallenges: { key: "/email", file: "challenges.json", ttl: -1 },
  copilotIntegrations: { key: "/partitionKey", file: "copilot-integrations.json", ttl: -1 },
};
export const emptyContainer = (id: string): BackupContainer => ({ definition: { id, partitionKey: { paths: [CONTAINERS[id]?.key ?? "/id"], kind: "Hash" },
  ...(CONTAINERS[id]?.ttl !== undefined ? { defaultTtl: CONTAINERS[id].ttl } : {}) }, items: [], scripts: { storedProcedures: [], triggers: [], userDefinedFunctions: [] } });

async function localJson(file: string, fallback: unknown): Promise<unknown> {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw error; }
}
function localItems(name: string, input: unknown): Document[] {
  if (name === "crm" && input && !Array.isArray(input)) {
    const overlay = input as { links?: Document[]; proposals?: Document[] };
    return [...(overlay.links ?? []).map((item) => ({ ...item, id: `link-${item.dealId}`, type: "link" })), ...(overlay.proposals ?? [])];
  }
  if (name === "documents" && input && !Array.isArray(input)) return Object.entries(input).map(([userId, value]) => ({ ...(value as object), id: userId, userId }));
  if (!Array.isArray(input)) throw new RecoveryError("invalid_local_data", `Invalid local ${name} store.`);
  return input;
}

async function readScriptInventory(entries: AsyncIterable<{ resource?: { id: string; body?: string; rid?: string; etag?: string; ts?: number } }>): Promise<Record<string, unknown>[]> {
  const scripts: Record<string, unknown>[] = [];
  for await (const entry of entries) {
    const resource = entry.resource;
    if (!resource || typeof resource.id !== "string" || !resource.id || typeof resource.body !== "string") {
      throw new RecoveryError("invalid_script_inventory", "Azure returned an incomplete script inventory.", 502);
    }
    const { rid, etag, ts, ...definition } = resource;
    scripts.push({ ...definition, ...(rid !== undefined ? { _rid: rid } : {}), ...(etag !== undefined ? { _etag: etag } : {}), ...(ts !== undefined ? { _ts: ts } : {}) });
  }
  return scripts;
}

export async function readDataset(target: string, progress: (label: string) => Promise<void> = async () => undefined): Promise<BackupContainer[]> {
  const database = rawDatabase(target);
  let provisioner: ReturnType<typeof management> | undefined;
  await progress("Reading container definitions");
  const definitions = database ? (await database.containers.readAll().fetchAll()).resources :
    await localJson(path.join(localTargetDirectory(target), "definitions.json"), Object.keys(CONTAINERS).map((name) => emptyContainer(name).definition)) as BackupContainer["definition"][];
  const result: BackupContainer[] = [];
  let bytes = 0;
  for (const definition of definitions) {
    await progress(`Reading documents from ${definition.id}`);
    let items: Document[];
    let scripts: BackupContainer["scripts"];
    if (database) {
      const container = database.container(definition.id);
      items = [];
      const iterator = container.items.readAll<Document>({ maxItemCount: 100 });
      while (iterator.hasMoreResults()) {
        const page = await iterator.fetchNext();
        const resources = page.resources ?? [];
        bytes += Buffer.byteLength(JSON.stringify(resources));
        if (bytes > EXPANDED_LIMIT) throw new RecoveryError("dataset_too_large", "The dataset exceeds the recovery size limit.");
        items.push(...resources);
      }
      await progress(`Reading stored procedures from ${definition.id}`);
      const { client, group, account } = provisioner ??= management();
      const storedProcedures = await readScriptInventory(client.sqlResources.listSqlStoredProcedures(group, account, target, definition.id));
      await progress(`Reading triggers from ${definition.id}`);
      const triggers = await readScriptInventory(client.sqlResources.listSqlTriggers(group, account, target, definition.id));
      await progress(`Reading user-defined functions from ${definition.id}`);
      const userDefinedFunctions = await readScriptInventory(client.sqlResources.listSqlUserDefinedFunctions(group, account, target, definition.id));
      scripts = { storedProcedures, triggers, userDefinedFunctions };
    } else {
      items = localItems(definition.id, await localJson(path.join(localTargetDirectory(target), CONTAINERS[definition.id]?.file ?? `${definition.id}.json`), []));
      scripts = await localJson(path.join(localTargetDirectory(target), `${definition.id}.scripts.json`), emptyContainer(definition.id).scripts) as BackupContainer["scripts"];
      bytes += Buffer.byteLength(JSON.stringify(items));
      if (bytes > EXPANDED_LIMIT) throw new RecoveryError("dataset_too_large", "The dataset exceeds the recovery size limit.");
    }
    result.push({ definition: definition as BackupContainer["definition"], items, scripts });
  }
  return result;
}

function management() {
  const match = /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/Microsoft\.DocumentDB\/databaseAccounts\/([^/]+)$/i.exec(process.env.COSMOS_RESOURCE_ID ?? "");
  if (!match || new URL(process.env.COSMOS_ENDPOINT!).hostname !== `${match[3]}.documents.azure.com`) throw new RecoveryError("configuration_error", "The Cosmos recovery resource is not configured correctly.", 503);
  return { client: new CosmosDBManagementClient(new DefaultAzureCredential({ managedIdentityClientId: process.env.RECOVERY_MANAGED_IDENTITY_CLIENT_ID }), match[1]), group: match[2], account: match[3] };
}
export async function writeDataset(target: string, containers: BackupContainer[], progress: (label: string) => Promise<void> = async () => undefined): Promise<void> {
  if (!/^restore-[a-f0-9-]{36}$/.test(target) || target === baselineDatabase()) throw new RecoveryError("unsafe_target", "Only a staged recovery database can be written.");
  const database = rawDatabase(target);
  if (database) {
    await progress("Creating staged database");
    const { client, group, account } = management();
    await client.sqlResources.beginCreateUpdateSqlDatabaseAndWait(group, account, target, { resource: { id: target }, options: {} });
    for (const container of containers) {
      await progress(`Creating container ${container.definition.id}`);
      const definition = Object.fromEntries(Object.entries(container.definition).filter(([key]) => !key.startsWith("_")));
      await client.sqlResources.beginCreateUpdateSqlContainerAndWait(group, account, target, container.definition.id, { resource: definition as unknown as SqlContainerResource, options: {} });
      const destination = database.container(container.definition.id);
      await progress(`Importing ${container.definition.id}`);
      for (let offset = 0; offset < container.items.length; offset += 4) {
        await Promise.all(container.items.slice(offset, offset + 4).map((item) => destination.items.upsert(portableDocument(item))));
      }
      if (Object.values(container.scripts).some((scripts) => scripts.length)) throw new RecoveryError("scripts_require_review", "Packages with executable Cosmos scripts require a reviewed operator migration.");
    }
  } else {
    const directory = localTargetDirectory(target);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(directory, "definitions.json"), JSON.stringify(containers.map((container) => container.definition)), { mode: 0o600 });
    for (const container of containers) {
      await progress(`Importing ${container.definition.id}`);
      const items = container.items.map(portableDocument);
      const data = container.definition.id === "crm" ? { links: items.filter((item) => item.type === "link"), proposals: items.filter((item) => item.type === "proposal") }
        : container.definition.id === "documents" ? Object.fromEntries(items.map((item) => [item.userId, item])) : items;
      await fs.writeFile(path.join(directory, CONTAINERS[container.definition.id]?.file ?? `${container.definition.id}.json`), JSON.stringify(data), { mode: 0o600 });
      await fs.writeFile(path.join(directory, `${container.definition.id}.scripts.json`), JSON.stringify(container.scripts), { mode: 0o600 });
    }
  }
}
export async function verifyDataset(target: string, expected: BackupContainer[], progress?: (label: string) => Promise<void>): Promise<void> {
  const actual = await readDataset(target, progress);
  await progress?.("Comparing container inventory");
  if (actual.length !== expected.length) throw new RecoveryError("verification_failed", "The staged container inventory does not match.");
  for (const container of expected) {
    await progress?.(`Verifying documents and policies for ${container.definition.id}`);
    const restored = actual.find((entry) => entry.definition.id === container.definition.id);
    if (!restored || portableHash(restored.items) !== portableHash(container.items)
      || JSON.stringify(restored.definition.partitionKey.paths) !== JSON.stringify(container.definition.partitionKey.paths)) {
      throw new RecoveryError("verification_failed", `Read-back verification failed for ${container.definition.id}.`);
    }
    for (const key of ["defaultTtl", "indexingPolicy", "uniqueKeyPolicy", "conflictResolutionPolicy", "computedProperties"]) {
      if (container.definition[key] !== undefined && JSON.stringify(canonical(restored.definition[key])) !== JSON.stringify(canonical(container.definition[key]))) {
        throw new RecoveryError("verification_failed", `The ${key} policy was not preserved for ${container.definition.id}.`);
      }
    }
  }
}