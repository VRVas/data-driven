import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { confirmJob, getRecoveryJob, jobView, loadArtifact, previewImport, previewSeed, processRecoveryJob, startBackup, cancelJob } from "@/lib/recovery/jobs";
import { changeControl, recoveryState, withDataset, type RecoveryState } from "@/lib/recovery/control";
import type { RecoveryJob } from "@/lib/recovery/jobs";
import * as datasets from "@/lib/recovery/datasets";
import { readDataset } from "@/lib/recovery/datasets";
import { readPackage } from "@/lib/recovery/package";
import * as control from "@/lib/recovery/control";

let cwd: string;
let directory: string;
const actor = { id: "fixture", name: "Fixture", email: "fixture@example.invalid", authority: "recovery-key" as const };
beforeEach(async () => { cwd = process.cwd(); directory = await mkdtemp(path.join(os.tmpdir(), "recovery-job-")); process.chdir(directory);
  vi.stubEnv("COSMOS_ENDPOINT", ""); vi.stubEnv("DATA_RECOVERY_ENABLED", "true"); vi.stubEnv("AUTH_SECRET", "recovery-unit-test-secret-000000000000000"); });
afterEach(async () => { vi.restoreAllMocks(); process.chdir(cwd); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe("durable recovery operations", () => {
  it("logs the original failure even when the job store cannot be read afterward", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const job = await previewSeed(actor, { name: "Fixture Admin", email: "fixture@example.invalid", password: "Fixture12345!" });
    await confirmJob(job.id, "INITIALIZE");
    const cleanupFailure = new Error("fixture control store unavailable");
    vi.spyOn(datasets, "writeDataset").mockImplementationOnce(async () => {
      vi.spyOn(control, "readControl").mockRejectedValue(cleanupFailure);
      throw Object.assign(new Error("fixture original read-back error"), { code: "ETIMEDOUT" });
    });
    await expect(processRecoveryJob(job.id)).rejects.toBe(cleanupFailure);
    expect(log).toHaveBeenCalledWith("[recovery] operation failed", expect.any(String));
    expect(JSON.parse(log.mock.calls[0][1] as string)).toMatchObject({ operationId: job.id, code: "ETIMEDOUT" });
    expect(JSON.stringify(log.mock.calls)).not.toContain(cleanupFailure.message);
  });

  it("keeps the previous dataset active when read-back fails after all staging writes", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const initial = await previewSeed(actor, { name: "Fixture Admin", email: "fixture@example.invalid", password: "Fixture12345!" });
    await confirmJob(initial.id, "INITIALIZE"); await processRecoveryJob(initial.id);
    const before = await recoveryState();
    const reset = await previewSeed(actor);
    const verify = datasets.verifyDataset;
    vi.spyOn(datasets, "verifyDataset").mockImplementation(async (target, expected, progress) => {
      if (target === reset.target) {
        expect((await readDataset(target)).find((container) => container.definition.id === "agents")!.items.length).toBeGreaterThan(0);
        await progress?.("Reading stored procedures from agents");
        throw Object.assign(new Error("fixture data-plane failure"), { code: 403, substatus: 5301 });
      }
      return verify(target, expected, progress);
    });
    await confirmJob(reset.id, `REPLACE ${initial.target}`); await processRecoveryJob(reset.id);
    const failed = await getRecoveryJob(reset.id);
    expect(failed.status).toBe("failed");
    expect(failed.progress).toBe("Reading stored procedures from agents");
    expect(failed.diagnostic).toMatchObject({ status: 403, substatus: 5301 });
    expect(failed.rollback).toBeTruthy();
    expect(await recoveryState()).toMatchObject({ active: before.active, epoch: before.epoch, mode: "ready", outboundPaused: before.outboundPaused });
    expect((await readDataset(reset.target)).find((container) => container.definition.id === "agents")!.items.length).toBeGreaterThan(0);
    expect(log).toHaveBeenCalledOnce();
  });

  it("records safe service diagnostics and the failed step without exposing exception contents", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const job = await previewSeed(actor, { name: "Fixture Admin", email: "fixture@example.invalid", password: "Fixture12345!" });
    const requestId = "11111111-2222-3333-4444-555555555555";
    vi.spyOn(datasets, "writeDataset").mockImplementationOnce(async (_target, _containers, progress) => {
      await progress?.("Creating staged database");
      throw Object.assign(new Error("private-token and private-record-body"), {
        name: "RestError", code: "AuthorizationFailed", statusCode: 403,
        cause: Object.assign(new Error("private nested credential"), { code: "ECONNRESET" }),
        stack: "RestError: private-token\n at readDataset (/app/.next/server/chunks/321.js:4:23)\n at verifyDataset (/workspaces/data-driven/src/lib/recovery/datasets.ts:142:21)\n at remote (https://example.invalid/private-token.js:1:2)\n private-record-body",
        request: { headers: { authorization: "Bearer private-token" } },
        response: { headers: new Headers({ "x-ms-request-id": requestId }), body: "private-record-body" },
      });
    });
    await confirmJob(job.id, "INITIALIZE");
    await processRecoveryJob(job.id);
    const failed = await getRecoveryJob(job.id);
    expect(failed.status).toBe("failed");
    expect(failed.progress).toBe("Creating staged database");
    expect(failed.diagnostic).toMatchObject({ name: "RestError", code: "AuthorizationFailed", status: 403, requestId, causeCode: "ECONNRESET", codeLocations: ["chunks/321.js:4:23", "datasets.ts:142:21"] });
    expect(jobView(failed).diagnostic).toEqual(failed.diagnostic);
    expect(log).toHaveBeenCalledWith("[recovery] operation failed", expect.any(String));
    expect(JSON.parse(log.mock.calls[0][1] as string)).toMatchObject({ operationId: job.id, progress: failed.progress, status: 403 });
    expect(JSON.stringify({ failed, logs: log.mock.calls })).not.toContain("private-token");
    expect(JSON.stringify({ failed, logs: log.mock.calls })).not.toContain("private-record-body");
    expect(JSON.stringify({ failed, logs: log.mock.calls })).not.toContain("private nested credential");
    expect(await recoveryState()).toMatchObject({ mode: "setup", active: "bd", epoch: 0 });
  });

  it("retains Cosmos status, substatus and activity IDs without arbitrary error text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const job = await previewSeed(actor, { name: "Fixture Admin", email: "fixture@example.invalid", password: "Fixture12345!" });
    vi.spyOn(datasets, "writeDataset").mockRejectedValueOnce(Object.assign(new Error("private document"), {
      code: 403, substatus: 5301, activityId: "11111111-2222-3333-4444-555555555555", requestId: "invalid\nprivate credential",
    }));
    await confirmJob(job.id, "INITIALIZE");
    await processRecoveryJob(job.id);
    const failed = await getRecoveryJob(job.id);
    expect(failed.diagnostic).toMatchObject({ name: "Error", status: 403, substatus: 5301, activityId: "11111111-2222-3333-4444-555555555555" });
    expect(failed.diagnostic?.requestId).toBeUndefined();
    expect(JSON.stringify(jobView(failed))).not.toContain("private");
    expect((await recoveryState()).active).toBe("bd");
  });

  it("retains the latest accounts when a built-in CRM reset was reviewed earlier", async () => {
    const initial = await previewSeed(actor, { name: "Fixture Admin", email: "fixture@example.invalid", password: "Fixture12345!" });
    await confirmJob(initial.id, "INITIALIZE"); await processRecoveryJob(initial.id);
    const reset = await previewSeed(actor);
    const current = await readDataset(initial.target);
    current.find((container) => container.definition.id === "users")!.items[0].name = "Updated after preview";
    await datasets.writeDataset(initial.target, current);
    await confirmJob(reset.id, `REPLACE ${initial.target}`); await processRecoveryJob(reset.id);
    const result = await getRecoveryJob(reset.id);
    expect(result.status).toBe("completed");
    expect((await readDataset(result.target)).find((container) => container.definition.id === "users")!.items[0].name).toBe("Updated after preview");
  });
  it("never resurrects a review canceled concurrently with confirmation", async () => {
    const job = await previewSeed(actor, { name: "Fixture Admin", email: "fixture@example.invalid", password: "Fixture12345!" });
    await Promise.allSettled([confirmJob(job.id, "INITIALIZE"), cancelJob(job.id)]);
    await processRecoveryJob(job.id);
    expect((await getRecoveryJob(job.id)).status).toBe("canceled");
    expect((await recoveryState()).mode).toBe("setup");
    expect((await recoveryState()).operation).toBeUndefined();
    expect((await recoveryState()).active).toBe("bd");
    await expect(confirmJob(job.id, "INITIALIZE")).rejects.toMatchObject({ status: 409 });
  });
  it("recovers an expired worker into a new staging database", async () => {
    const job = await previewSeed(actor, { name: "Fixture Admin", email: "fixture@example.invalid", password: "Fixture12345!" });
    await confirmJob(job.id, "INITIALIZE");
    await changeControl<RecoveryJob>(job.id, (record) => ({ ...record, status: "running", leaseOwner: "dead-worker", leaseUntil: new Date(0).toISOString() }));
    await changeControl<RecoveryState>("state", (state) => ({ ...state, worker: { owner: "dead-worker", until: new Date(0).toISOString() } }));
    await processRecoveryJob(job.id);
    const recovered = await getRecoveryJob(job.id);
    expect(recovered.status).toBe("completed");
    expect(recovered.target).not.toBe(job.target);
    expect((await recoveryState()).active).toBe(recovered.target);
  });

  it("cannot activate after losing its worker fence during copying", async () => {
    const job = await previewSeed(actor, { name: "Fixture Admin", email: "fixture@example.invalid", password: "Fixture12345!" });
    await confirmJob(job.id, "INITIALIZE");
    const original = datasets.writeDataset;
    vi.spyOn(datasets, "writeDataset").mockImplementationOnce(async (target, containers, progress) => {
      await original(target, containers, progress);
      await changeControl<RecoveryState>("state", (state) => ({ ...state, worker: { owner: "replacement-worker", until: new Date(Date.now() + 90000).toISOString() } }));
    });
    await processRecoveryJob(job.id);
    expect((await recoveryState()).active).toBe("bd");
    expect((await recoveryState()).mode).toBe("maintenance");
  });
  it("initializes an empty environment and makes a verified encrypted backup", async () => {
    const job = await previewSeed(actor, { name: "Fixture Admin", email: "fixture@example.invalid", password: "Fixture12345!" });
    await expect(confirmJob(job.id, "wrong")).rejects.toMatchObject({ code: "confirmation_required" });
    await confirmJob(job.id, "INITIALIZE");
    await expect(withDataset(async () => 1)).rejects.toMatchObject({ code: "maintenance" });
    await processRecoveryJob(job.id);
    expect((await getRecoveryJob(job.id)).status).toBe("completed");
    expect((await recoveryState()).active).toBe(job.target);
    expect((await recoveryState()).outboundPaused).toBe(true);
    const backup = await startBackup(actor, "fixture-backup-password");
    await processRecoveryJob(backup.id);
    const result = await getRecoveryJob(backup.id);
    expect(result.status).toBe("completed");
    const downloaded = await readPackage(await loadArtifact(result.output!), "fixture-backup-password");
    expect(downloaded.containers.find((container) => container.definition.id === "users")!.items[0].email).toBe("fixture@example.invalid");
    expect((await recoveryState()).epoch).toBe(1);
  });
  it("cancels a confirmed import without activating its target", async () => {
    const job = await previewSeed(actor, { name: "Fixture Admin", email: "fixture@example.invalid", password: "Fixture12345!" });
    await confirmJob(job.id, "INITIALIZE");
    await cancelJob(job.id);
    await processRecoveryJob(job.id);
    expect((await recoveryState()).active).toBe("bd");
    expect((await getRecoveryJob(job.id)).status).toBe("canceled");
  });
  it("replaces a populated environment and retains the original dataset", async () => {
    const seed = await previewSeed(actor, { name: "Fixture Admin", email: "fixture@example.invalid", password: "Fixture12345!" });
    await confirmJob(seed.id, "INITIALIZE"); await processRecoveryJob(seed.id);
    const backup = await startBackup(actor, "fixture-backup-password"); await processRecoveryJob(backup.id);
    const upload = await loadArtifact((await getRecoveryJob(backup.id)).output!);
    const replacement = await previewImport(actor, upload, "fixture-backup-password", "full");
    expect(replacement.initialMode).toBe("ready");
    await confirmJob(replacement.id, `REPLACE ${seed.target}`); await processRecoveryJob(replacement.id);
    expect((await getRecoveryJob(replacement.id)).status).toBe("completed");
    expect((await recoveryState()).previous).toBe(seed.target);
    expect((await readDataset(seed.target)).find((container) => container.definition.id === "brands")!.items.length).toBeGreaterThan(0);
    expect((await getRecoveryJob(replacement.id)).rollback).toBeTruthy();
  });
});