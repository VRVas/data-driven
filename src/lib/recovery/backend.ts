import "server-only";
import { CosmosClient, type Database } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";

export const recoveryEnabled = (): boolean => process.env.DATA_RECOVERY_ENABLED === "true";
export const baselineDatabase = (): string => process.env.COSMOS_DATABASE ?? "bd";
let client: CosmosClient | undefined;
export function rawDatabase(name: string): Database | null {
  if (!process.env.COSMOS_ENDPOINT) return null;
  client ??= new CosmosClient({ endpoint: process.env.COSMOS_ENDPOINT, aadCredentials: new DefaultAzureCredential(),
    connectionPolicy: { requestTimeout: 30000, retryOptions: { maxRetryAttemptCount: 3, maxWaitTimeInSeconds: 15 } } });
  return client.database(name);
}
export const controlDatabaseName = (): string => process.env.COSMOS_CONTROL_DATABASE ?? `${baselineDatabase()}-recovery`;