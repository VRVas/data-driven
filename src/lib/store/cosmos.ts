import "server-only";
import { CosmosClient, type Database } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";

/**
 * Lazily-constructed Cosmos DB (NoSQL) handle.
 *
 * Auth is Microsoft Entra ID only (no keys) - DefaultAzureCredential resolves the
 * Container App's user-assigned managed identity via AZURE_CLIENT_ID at runtime.
 * Returns null when COSMOS_ENDPOINT is unset (local dev falls back to a file store).
 */
let db: Database | null | undefined;

export function getCosmosDb(): Database | null {
  if (db !== undefined) return db;

  const endpoint = process.env.COSMOS_ENDPOINT;
  const databaseId = process.env.COSMOS_DATABASE ?? "bd";
  if (!endpoint) {
    db = null;
    return db;
  }

  const client = new CosmosClient({
    endpoint,
    aadCredentials: new DefaultAzureCredential(),
  });
  db = client.database(databaseId);
  return db;
}

export function isCosmosConfigured(): boolean {
  return !!process.env.COSMOS_ENDPOINT;
}
