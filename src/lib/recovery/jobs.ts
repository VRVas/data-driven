import "server-only";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import dataset from "@/data/dataset.json";
import { hashPassword, signupSchema } from "@/lib/auth/password";
import { recoveryEnabled } from "./backend";
import { changeControl, controlRecord, listControl, readControl, recoveryState, saveControl, type ControlRecord, type RecoveryState } from "./control";
import { emptyContainer, readDataset, verifyDataset, writeDataset } from "./datasets";
import { decryptPackage, encryptPackage, readPackage, sha256, writePackage, RecoveryError, type BackupContainer } from "./package";
import { prepareImport, type ImportMode, type ImportChange } from "./policy";

export interface RecoveryActor { id: string; name: string; email: string; authority: "administrator" | "recovery-key" }
interface RecoveryDiagnostic {
  recordedAt: string;
  name: string;
  code?: string;
  status?: number;
  substatus?: number;
  activityId?: string;
  requestId?: string;
  causeCode?: string;
  codeLocations?: string[];
}
export interface RecoveryJob extends ControlRecord {
  kind: "job";
  type: "backup" | "import" | "rollback" | "seed";
  status: "review" | "queued" | "running" | "completed" | "failed" | "canceled";
  createdAt: string;
  actor: RecoveryActor;
  base: string;
  epoch: number;
  initialMode: "ready" | "setup";
  importMode: ImportMode;
  input?: string;
  prepared?: string;
  password?: string;
  output?: string;
  rollback?: string;
  target: string;
  progress: string;
  error?: string;
  diagnostic?: RecoveryDiagnostic;
  leaseOwner?: string;
  leaseUntil?: string;
  report: { containers: { name: string; documents: number }[]; changes: ImportChange[]; warnings: string[]; sourceDigest?: string };
}
interface ArtifactRecord extends ControlRecord { kind: "artifact"; chunks: number; hash: string; bytes: number }
interface ChunkRecord extends ControlRecord { kind: "chunk"; value: string }
const STORAGE_TTL = 7 * 86400;
function recoveryDiagnostic(error: unknown): RecoveryDiagnostic {
  const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const identifier = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(value) ? value : undefined;
  const response = details.response as { headers?: { get?: (name: string) => unknown } } | undefined;
  const header = (name: string): unknown => {
    try { return response?.headers?.get?.(name); } catch { return undefined; }
  };
  const status = [details.statusCode, details.status, details.code].find((value) => typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599);
  const cause = details.cause && typeof details.cause === "object" ? details.cause as Record<string, unknown> : {};
  const codeLocations = typeof details.stack === "string" ? details.stack.split("\n").slice(1).flatMap((line) => {
    const match = /^\s+at\s+.*[\\/](?:\.next[\\/]server|src[\\/]lib[\\/]recovery)[\\/]([A-Za-z0-9_./()\\-]+\.(?:[cm]?js|tsx?):\d+:\d+)\)?$/.exec(line);
    return match && match[1].length <= 180 ? [match[1].replaceAll("\\", "/")] : [];
  }).slice(0, 5) : [];
  return {
    recordedAt: new Date().toISOString(),
    name: identifier(details.name) ?? "UnknownError",
    code: identifier(details.code),
    status: typeof status === "number" ? status : undefined,
    substatus: typeof details.substatus === "number" && Number.isInteger(details.substatus) ? details.substatus : undefined,
    activityId: identifier(details.activityId ?? header("x-ms-activity-id")),
    requestId: identifier(details.requestId ?? header("x-ms-request-id") ?? header("x-ms-correlation-request-id")),
    causeCode: identifier(cause.code),
    codeLocations: codeLocations.length ? codeLocations : undefined,
  };
}
function storagePassword(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new RecoveryError("configuration_error", "A stable AUTH_SECRET of at least 32 characters is required for recovery storage.", 503);
  return sha256(`recovery-artifacts:${secret}`);
}
export async function saveArtifact(data: Buffer): Promise<string> {
  const id = randomUUID();
  const encrypted = encryptPackage(data, storagePassword());
  let chunks = 0;
  for (let offset = 0; offset < encrypted.length; offset += 256 * 1024) {
    await saveControl<ChunkRecord>({ ...controlRecord("chunk", `chunk:${id}:${chunks++}`), kind: "chunk", value: encrypted.subarray(offset, offset + 256 * 1024).toString("base64"), ttl: STORAGE_TTL });
  }
  await saveControl<ArtifactRecord>({ ...controlRecord("artifact", id), kind: "artifact", chunks, hash: sha256(encrypted), bytes: encrypted.length, ttl: STORAGE_TTL });
  return id;
}
export async function loadArtifact(id: string): Promise<Buffer> {
  const metadata = await readControl<ArtifactRecord>(id);
  if (!metadata || metadata.kind !== "artifact" || Date.parse(metadata.updatedAt) + STORAGE_TTL * 1000 <= Date.now()) throw new RecoveryError("artifact_expired", "The recovery package has expired.", 410);
  const chunks: Buffer[] = [];
  for (let index = 0; index < metadata.chunks; index++) {
    const chunk = await readControl<ChunkRecord>(`chunk:${id}:${index}`);
    if (!chunk) throw new RecoveryError("artifact_incomplete", "Recovery storage is incomplete.", 503);
    chunks.push(Buffer.from(chunk.value, "base64"));
  }
  const encrypted = Buffer.concat(chunks);
  if (encrypted.length !== metadata.bytes || sha256(encrypted) !== metadata.hash) throw new RecoveryError("artifact_incomplete", "Recovery storage failed integrity verification.", 503);
  return decryptPackage(encrypted, storagePassword());
}
export async function getRecoveryJob(id: string): Promise<RecoveryJob> {
  const job = await readControl<RecoveryJob>(id);
  if (!job || job.kind !== "job") throw new RecoveryError("job_not_found", "Recovery operation not found.", 404);
  return job;
}
export function jobView(job: RecoveryJob) {
  return { id: job.id, type: job.type, status: job.status, createdAt: job.createdAt, updatedAt: job.updatedAt, actor: job.actor.name,
    base: job.base, target: job.target, progress: job.progress, error: job.error, diagnostic: job.diagnostic, importMode: job.importMode, report: job.report,
    downloadable: !!job.output, hasRollback: !!job.rollback, confirmation: job.initialMode === "setup" ? "INITIALIZE" : `REPLACE ${job.base}` };
}
function describe(containers: BackupContainer[], changes: ImportChange[] = [], warnings: string[] = []): RecoveryJob["report"] {
  return { containers: containers.map((container) => ({ name: container.definition.id, documents: container.items.length })), changes, warnings };
}
async function newJob(actor: RecoveryActor, type: RecoveryJob["type"], mode: ImportMode): Promise<RecoveryJob> {
  if (!recoveryEnabled()) throw new RecoveryError("recovery_disabled", "Data recovery is disabled.", 503);
  const state = await recoveryState();
  if (state.mode === "maintenance") throw new RecoveryError("operation_active", "Another recovery operation is active.", 409);
  if (type === "backup" && state.mode === "setup") throw new RecoveryError("empty_environment", "Initialize this environment before taking a backup.");
  return { ...controlRecord("job", randomUUID()), kind: "job", createdAt: new Date().toISOString(), type, status: "review", actor,
    base: state.active, epoch: state.epoch, initialMode: state.mode, importMode: mode, target: `restore-${randomUUID()}`, progress: "Ready for review", report: describe([]) };
}
export async function previewImport(actor: RecoveryActor, buffer: Buffer, password: string | undefined, mode: ImportMode): Promise<RecoveryJob> {
  const job = await newJob(actor, "import", mode);
  const backup = await readPackage(buffer, password);
  const current = mode === "crm" ? await readDataset(job.base) : [];
  const plan = prepareImport(backup.containers, mode, current);
  job.report = { ...describe(plan.containers, plan.changes, plan.warnings), sourceDigest: backup.digest };
  job.input = await saveArtifact(decryptPackage(buffer, password));
  return (await saveControl(job))!;
}
export async function previewSeed(actor: RecoveryActor, account?: { name: string; email: string; password: string }): Promise<RecoveryJob> {
  const job = await newJob(actor, "seed", "crm");
  const current = await readDataset(job.base);
  if (job.initialMode === "setup") {
    if (!account) throw new RecoveryError("administrator_required", "Create the initial administrator account.");
    const parsed = signupSchema.parse(account);
    current.push({ ...emptyContainer("users"), items: [{ id: randomUUID(), name: parsed.name, email: parsed.email, passwordHash: await hashPassword(parsed.password), role: "admin", active: true, createdAt: new Date().toISOString(), permissionsVersion: 1 }] });
    const original = current.findIndex((container) => container.definition.id === "users" && container.items.length === 0);
    if (original >= 0) current.splice(original, 1);
  }
  const business: BackupContainer[] = [{ ...emptyContainer("brands"), items: dataset.brands }, { ...emptyContainer("agents"), items: dataset.agents }];
  const plan = prepareImport(business, "crm", current);
  job.input = await saveArtifact(await writePackage("bd", job.initialMode === "setup" ? plan.containers : business, new Date().toISOString()));
  job.importMode = job.initialMode === "setup" ? "full" : "crm";
  job.report = describe(plan.containers, plan.changes, plan.warnings);
  return (await saveControl(job))!;
}
export async function previewRollback(actor: RecoveryActor): Promise<RecoveryJob> {
  const state = await recoveryState();
  if (!state.previous) throw new RecoveryError("no_rollback", "There is no previous dataset to restore.");
  const job = await newJob(actor, "rollback", "full");
  const source = await readDataset(state.previous);
  const plan = prepareImport(source, "full", []);
  job.input = await saveArtifact(await writePackage("bd", source, new Date().toISOString()));
  job.report = describe(plan.containers, plan.changes, plan.warnings);
  return (await saveControl(job))!;
}
export async function startBackup(actor: RecoveryActor, password: string): Promise<RecoveryJob> {
  encryptPackage(Buffer.alloc(0), password);
  const job = await newJob(actor, "backup", "full");
  job.password = await saveArtifact(Buffer.from(password));
  await saveControl(job);
  return confirmJob(job.id, "BACKUP");
}
export async function confirmJob(id: string, confirmation: string): Promise<RecoveryJob> {
  const job = await getRecoveryJob(id);
  const expected = job.type === "backup" ? "BACKUP" : jobView(job).confirmation;
  if (confirmation !== expected) throw new RecoveryError("confirmation_required", `Type ${expected} to continue.`);
  if (job.status !== "review") throw new RecoveryError("already_confirmed", "This operation was already decided.", 409);
  await changeControl<RecoveryState>("state", (state) => {
    if (state.operation || state.mode === "maintenance" || state.epoch !== job.epoch || state.active !== job.base) throw new RecoveryError("environment_changed", "The environment changed. Upload and review again.", 409);
    return { ...state, mode: "maintenance", operation: job.id, worker: undefined };
  });
  try {
    return await changeControl<RecoveryJob>(id, (current) => {
      if (["canceled", "failed", "completed"].includes(current.status)) throw new RecoveryError("already_decided", "This operation was already decided.", 409);
      return current.status === "review" ? { ...current, status: "queued", progress: "Waiting for current operations" } : current;
    });
  } catch (error) {
    await changeControl<RecoveryState>("state", (state) => state.operation === id && !state.worker ? { ...state, mode: job.initialMode, operation: undefined } : state);
    throw error;
  }
}
export async function cancelJob(id: string): Promise<RecoveryJob> {
  const job = await getRecoveryJob(id);
  if (job.status === "completed") throw new RecoveryError("already_complete", "The operation has completed. Use rollback to restore the prior dataset.", 409);
  await changeControl<RecoveryState>("state", (state) => {
    if (state.lastOperation === id) throw new RecoveryError("already_complete", "The operation has activated. Use rollback to restore the prior dataset.", 409);
    return state.operation === id ? { ...state, mode: job.initialMode, operation: undefined, worker: undefined } : state;
  });
  const changed = await changeControl<RecoveryJob>(id, (current) => ({ ...current, status: "canceled", leaseOwner: undefined, leaseUntil: undefined, progress: "Canceled; active dataset unchanged" }));
  return changed;
}

export async function processRecoveryJob(id: string): Promise<void> {
  let job = await getRecoveryJob(id);
  const state = await recoveryState();
  if (job.status === "review" && state.operation === id) job = await changeControl<RecoveryJob>(id, (record) => record.status === "review" ? { ...record, status: "queued" } : record);
  if (!["queued", "running"].includes(job.status) || job.leaseUntil && Date.parse(job.leaseUntil) > Date.now()) return;
  const lease = randomUUID();
  const until = new Date(Date.now() + 90000).toISOString();
  const gate = await readControl<RecoveryState>("state");
  if (!gate || gate.operation !== id || gate.worker && Date.parse(gate.worker.until) > Date.now()) return;
  if (!(await saveControl({ ...gate, worker: { owner: lease, until } }, gate._etag))) return;
  const claimed = await saveControl({ ...job, status: "running" as const, leaseOwner: lease, leaseUntil: until,
    target: job.status === "running" && job.type !== "backup" ? `restore-${randomUUID()}` : job.target }, job._etag);
  if (!claimed) {
    await changeControl<RecoveryState>("state", (current) => current.worker?.owner === lease ? { ...current, worker: undefined } : current);
    return;
  }
  job = claimed;
  const checkpoint = async (progress: string, update: Partial<RecoveryJob> = {}) => {
    if (update.status !== "completed") await changeControl<RecoveryState>("state", (current) => {
      if (current.operation !== id || current.worker?.owner !== lease || Date.parse(current.worker.until) <= Date.now()) throw new RecoveryError("job_interrupted", "This worker no longer owns the recovery operation.", 409);
      return { ...current, worker: { owner: lease, until: new Date(Date.now() + 90000).toISOString() } };
    });
    job = await changeControl<RecoveryJob>(id, (current) => {
      if (current.leaseOwner !== lease || current.status !== "running") throw new RecoveryError("job_interrupted", "The operation was interrupted.", 409);
      return { ...current, ...update, progress, leaseUntil: new Date(Date.now() + 90000).toISOString() };
    });
  };
  const heartbeat = setInterval(() => { void checkpoint(job.progress).catch(() => undefined); }, 15000);
  try {
    const drainDeadline = Date.now() + 210000;
    while (true) {
      const current = await recoveryState();
      if (current.operation !== id || current.active !== job.base || current.worker?.owner !== lease) throw new RecoveryError("job_interrupted", "The recovery operation lost its maintenance fence.", 409);
      if (!Object.values(current.activities).some((activity) => Date.parse(activity.expiresAt) > Date.now())) break;
      if (Date.now() > drainDeadline) throw new RecoveryError("drain_timeout", "Active work did not finish. Cancel and retry after it stops.", 409);
      await delay(250);
    }
    if (!job.rollback && job.initialMode === "ready") {
      const before = await readDataset(job.base, checkpoint);
      await verifyDataset(job.base, before, checkpoint);
      const rollback = await saveArtifact(await writePackage("bd", before, job.createdAt));
      await checkpoint("Rollback backup verified", { rollback });
    }
    if (job.type === "backup") {
      const raw = job.rollback ? await loadArtifact(job.rollback) : await writePackage("bd", await readDataset(job.base, checkpoint), job.createdAt);
      const output = await saveArtifact(encryptPackage(raw, (await loadArtifact(job.password!)).toString("utf8")));
      const parsed = await readPackage(raw);
      await checkpoint("Backup verified", { output, report: describe(parsed.containers) });
    } else {
      let prepared: BackupContainer[];
      if (job.prepared) prepared = (await readPackage(await loadArtifact(job.prepared))).containers;
      else {
        const backup = await readPackage(await loadArtifact(job.input!));
        const current = job.importMode === "crm" ? await readDataset(job.base, checkpoint) : [];
        const plan = prepareImport(backup.containers, job.importMode, current);
        prepared = plan.containers;
        const artifact = await saveArtifact(await writePackage("bd", prepared, job.createdAt));
        await checkpoint("Import plan saved", { prepared: artifact, report: { ...describe(prepared, plan.changes, plan.warnings), sourceDigest: job.report.sourceDigest } });
      }
      await writeDataset(job.target, prepared, checkpoint);
      await verifyDataset(job.target, prepared, checkpoint);
      await checkpoint("Staged dataset verified");
    }
    await changeControl<RecoveryState>("state", (current) => {
      if (current.operation !== id || current.epoch !== job.epoch || current.worker?.owner !== lease || Date.parse(current.worker.until) <= Date.now()) throw new RecoveryError("job_interrupted", "The active dataset changed before activation.", 409);
      return { ...current, mode: "ready", operation: undefined, worker: undefined, lastOperation: id, activities: {}, ...(job.type === "backup" ? {} : {
        previous: current.active, active: job.target, epoch: current.epoch + 1, outboundPaused: true }) };
    });
    await checkpoint(job.type === "backup" ? "Backup ready to download" : "Import verified and activated", { status: "completed", leaseOwner: undefined, leaseUntil: undefined });
  } catch (error) {
    const diagnostic = recoveryDiagnostic(error);
    console.error("[recovery] operation failed", JSON.stringify({ operationId: id, type: job.type, progress: job.progress, ...diagnostic }));
    const current = await getRecoveryJob(id);
    if (current.leaseOwner === lease && current.status === "running") {
      const active = await recoveryState();
      if (active.lastOperation === id) {
        await changeControl<RecoveryJob>(id, (record) => ({ ...record, status: "completed", progress: "Import activated", leaseOwner: undefined, leaseUntil: undefined }));
      } else if (active.worker?.owner === lease) {
        await changeControl<RecoveryJob>(id, (record) => ({ ...record, status: "failed", diagnostic, error: error instanceof RecoveryError ? error.message : "The operation failed. The previous dataset remains active. Check the operation diagnostics and server logs before retrying.", leaseOwner: undefined, leaseUntil: undefined }));
        await changeControl<RecoveryState>("state", (record) => record.operation === id && record.worker?.owner === lease ? { ...record, mode: job.initialMode, operation: undefined, worker: undefined } : record);
      }
    }
  } finally { clearInterval(heartbeat); }
}

let timer: ReturnType<typeof setInterval> | undefined;
let busy = false;
export function startRecoveryWorker(): void {
  if (timer || !recoveryEnabled()) return;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const state = await recoveryState();
      if (state.operation) await processRecoveryJob(state.operation);
      else if (state.lastOperation) {
        const last = await getRecoveryJob(state.lastOperation);
        if (["running", "queued"].includes(last.status)) await changeControl<RecoveryJob>(last.id, (record) => ({ ...record, status: "completed", progress: "Operation completed", leaseOwner: undefined, leaseUntil: undefined }));
      }
    } catch (error) { console.error("[recovery] operation check failed", JSON.stringify(recoveryDiagnostic(error))); }
    finally { busy = false; }
  };
  timer = setInterval(() => { void tick(); }, 1500); timer.unref(); void tick();
}
export async function recentRecoveryJobs() {
  return (await listControl<RecoveryJob>("job")).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 30).map(jobView);
}