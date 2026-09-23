import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { withFileLock, writeJsonAtomic } from "@/lib/store/local-json";
import { baselineDatabase, controlDatabaseName, rawDatabase, recoveryEnabled } from "./backend";
import { RecoveryError } from "./package";
import { dataDirectory } from "@/lib/store/location";

export interface ControlRecord { id: string; kind: string; partitionKey: "recovery"; _etag?: string; updatedAt: string; ttl?: number }
export interface RecoveryState extends ControlRecord {
  kind: "state";
  active: string;
  epoch: number;
  mode: "setup" | "ready" | "maintenance";
  outboundPaused: boolean;
  activities: Record<string, { expiresAt: string }>;
  operation?: string;
  previous?: string;
  lastOperation?: string;
  worker?: { owner: string; until: string };
}
const controlFile = () => path.join(dataDirectory(), "recovery", "control.json");
export const controlRecord = (kind: string, id: string): ControlRecord => ({ kind, id, partitionKey: "recovery", updatedAt: new Date().toISOString() });

async function readLocal(): Promise<ControlRecord[]> {
  try { const rows = JSON.parse(await fs.readFile(controlFile(), "utf8")); if (!Array.isArray(rows)) throw new Error("Invalid recovery state"); return rows; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
const controlContainer = () => rawDatabase(controlDatabaseName())?.container("operations");
export async function readControl<T extends ControlRecord>(id: string): Promise<T | null> {
  const container = controlContainer();
  if (!container) return (await readLocal()).find((row) => row.id === id) as T ?? null;
  try { return (await container.item(id, "recovery").read<T>()).resource ?? null; }
  catch (error) { if ((error as { code: number }).code === 404) return null; throw error; }
}
export async function saveControl<T extends ControlRecord>(record: T, etag?: string): Promise<T | null> {
  const saved = { ...record, updatedAt: new Date().toISOString() };
  const container = controlContainer();
  if (container) {
    try {
      const response = etag ? await container.item(record.id, "recovery").replace<T>(saved, { accessCondition: { type: "IfMatch", condition: etag } }) : await container.items.create<T>(saved);
      if (!response.resource) throw new Error("Recovery write returned no record");
      return response.resource;
    } catch (error) { if ([409, 412].includes((error as { code: number }).code)) return null; throw error; }
  }
  return withFileLock(controlFile(), async () => {
    const records = await readLocal();
    const index = records.findIndex((row) => row.id === record.id);
    if (etag ? index < 0 || records[index]._etag !== etag : index >= 0) return null;
    const versioned = { ...saved, _etag: randomUUID() };
    if (index < 0) records.push(versioned); else records[index] = versioned;
    await writeJsonAtomic(controlFile(), records);
    await fs.chmod(controlFile(), 0o600);
    return versioned;
  });
}
export async function listControl<T extends ControlRecord>(kind: string): Promise<T[]> {
  const container = controlContainer();
  if (!container) return (await readLocal()).filter((row) => row.kind === kind) as T[];
  return (await container.items.query<T>({ query: "SELECT * FROM c WHERE c.kind = @kind", parameters: [{ name: "@kind", value: kind }] }, { partitionKey: "recovery" }).fetchAll()).resources;
}
export async function changeControl<T extends ControlRecord>(id: string, mutate: (record: T) => T): Promise<T> {
  for (let attempt = 0; attempt < 64; attempt++) {
    const current = await readControl<T>(id);
    if (!current) throw new RecoveryError("state_missing", "Recovery state is unavailable.", 503);
    const result = await saveControl(mutate(current), current._etag);
    if (result) return result;
  }
  throw new RecoveryError("control_busy", "Recovery state is busy. Retry shortly.", 409);
}

async function hasExistingData(): Promise<boolean> {
  const database = rawDatabase(baselineDatabase());
  if (database) {
    for (const container of (await database.containers.readAll().fetchAll()).resources) {
      const page = await database.container(container.id).items.query("SELECT TOP 1 c.id FROM c").fetchAll();
      if (page.resources.length) return true;
    }
    return false;
  }
  try {
    for (const file of ["users.json", "brands.json", "agents.json"]) {
      try { if (JSON.parse(await fs.readFile(path.join(dataDirectory(), file), "utf8")).length) return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  } catch (error) { throw error; }
  return false;
}
export async function recoveryState(): Promise<RecoveryState> {
  if (!recoveryEnabled()) return { ...controlRecord("state", "state"), kind: "state", active: baselineDatabase(), epoch: 0, mode: "ready", outboundPaused: false, activities: {} };
  const current = await readControl<RecoveryState>("state");
  if (current) return current;
  const existing = await hasExistingData();
  const initial: RecoveryState = { ...controlRecord("state", "state"), kind: "state", active: baselineDatabase(), epoch: 0,
    mode: existing ? "ready" : "setup", outboundPaused: !existing, activities: {} };
  return await saveControl(initial) ?? (await readControl<RecoveryState>("state"))!;
}

const processContext = globalThis as typeof globalThis & { __recoveryDatasetScope?: AsyncLocalStorage<{ target: string; signal: AbortSignal }> };
const scope = processContext.__recoveryDatasetScope ??= new AsyncLocalStorage<{ target: string; signal: AbortSignal }>();
async function checkSessionEpoch(epoch: number): Promise<void> {
  try { await (await import("next/headers")).headers(); }
  catch (error) {
    if (error instanceof Error && /outside a request scope/.test(error.message)) return;
    throw error;
  }
  const session = await (await import("@/auth")).auth();
  if (session?.user && (session.user.dataEpoch ?? 0) !== epoch) throw new RecoveryError("session_expired", "The dataset changed. Sign in again.", 401);
}
export async function withDataset<T>(work: (target: string, signal: AbortSignal) => Promise<T>, credentialCheck = false): Promise<T> {
  const inherited = scope.getStore();
  if (inherited) { inherited.signal.throwIfAborted(); return work(inherited.target, inherited.signal); }
  if (!recoveryEnabled()) return work(baselineDatabase(), new AbortController().signal);
  const observed = await recoveryState();
  if (!credentialCheck) await checkSessionEpoch(observed.epoch);
  const activityId = randomUUID();
  const expiresAt = new Date(Date.now() + 180000).toISOString();
  const admitted = await changeControl<RecoveryState>("state", (state) => {
    if (state.mode !== "ready") throw new RecoveryError("maintenance", "The environment is being initialized or restored. Open Data & Recovery.", 503);
    if (state.epoch !== observed.epoch) throw new RecoveryError("dataset_changed", "The dataset changed. Retry the request.", 409);
    return { ...state, activities: { ...state.activities, [activityId]: { expiresAt } } };
  });
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new RecoveryError("operation_timeout", "The data operation timed out.", 503)), 120000);
  try { return await scope.run({ target: admitted.active, signal: controller.signal }, () => work(admitted.active, controller.signal)); }
  finally {
    clearTimeout(deadline);
    await changeControl<RecoveryState>("state", (state) => { const activities = { ...state.activities }; delete activities[activityId]; return { ...state, activities }; });
  }
}
export async function assertOutboundAllowed(): Promise<void> {
  const state = await recoveryState();
  if (state.mode !== "ready" || state.outboundPaused) throw new RecoveryError("outbound_paused", "Outbound delivery is paused in Data & Recovery.", 503);
}
export function localTargetDirectory(target: string): string {
  if (target === baselineDatabase()) return dataDirectory();
  if (!/^restore-[a-f0-9-]{36}$/.test(target)) throw new RecoveryError("invalid_target", "Invalid recovery dataset.");
  return path.join(dataDirectory(), "recovery", "datasets", target);
}
export function isDatasetFile(file: string): boolean { return path.dirname(path.resolve(file)) === dataDirectory(); }
export async function withLocalFile<T>(file: string, work: (resolved: string) => Promise<T>): Promise<T> {
  if (!recoveryEnabled() || !isDatasetFile(file)) return work(file);
  return withDataset((target) => work(path.join(localTargetDirectory(target), path.basename(file))));
}