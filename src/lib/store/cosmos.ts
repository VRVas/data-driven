import "server-only";
import type { Database } from "@azure/cosmos";
import { baselineDatabase, rawDatabase, recoveryEnabled } from "@/lib/recovery/backend";
import { routedDatabase } from "@/lib/recovery/routing";

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

  const database = rawDatabase(baselineDatabase());
  db = database && recoveryEnabled() ? routedDatabase(database) : database;
  return db;
}

export function isCosmosConfigured(): boolean {
  return !!process.env.COSMOS_ENDPOINT;
}
