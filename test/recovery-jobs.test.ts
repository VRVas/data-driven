import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { confirmJob, getRecoveryJob, loadArtifact, previewImport, previewSeed, processRecoveryJob, startBackup, cancelJob } from "@/lib/recovery/jobs";
import { changeControl, recoveryState, withDataset, type RecoveryState } from "@/lib/recovery/control";
import type { RecoveryJob } from "@/lib/recovery/jobs";
import * as datasets from "@/lib/recovery/datasets";
import { readDataset } from "@/lib/recovery/datasets";
import { readPackage } from "@/lib/recovery/package";

let cwd: string;
let directory: string;
const actor = { id: "fixture", name: "Fixture", email: "fixture@example.invalid", authority: "recovery-key" as const };
beforeEach(async () => { cwd = process.cwd(); directory = await mkdtemp(path.join(os.tmpdir(), "recovery-job-")); process.chdir(directory);
  vi.stubEnv("COSMOS_ENDPOINT", ""); vi.stubEnv("DATA_RECOVERY_ENABLED", "true"); vi.stubEnv("AUTH_SECRET", "recovery-unit-test-secret-000000000000000"); });
afterEach(async () => { vi.restoreAllMocks(); process.chdir(cwd); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe("durable recovery operations", () => {
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