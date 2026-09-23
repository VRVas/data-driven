import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { dataFs } from "@/lib/recovery/routing";
import { writeJsonAtomic } from "@/lib/store/local-json";
import os from "node:os";
import path from "node:path";
import { changeControl, recoveryState, withDataset, type RecoveryState } from "@/lib/recovery/control";

let directory: string;
let cwd: string;
beforeEach(async () => { cwd = process.cwd(); directory = await mkdtemp(path.join(os.tmpdir(), "recovery-control-")); process.chdir(directory); vi.stubEnv("DATA_RECOVERY_ENABLED", "true"); vi.stubEnv("COSMOS_ENDPOINT", ""); });
afterEach(async () => { vi.unstubAllEnvs(); process.chdir(cwd); await rm(directory, { recursive: true, force: true }); });

describe("independent recovery control", () => {
  it("routes local reads and writes to the selected dataset and blocks writes in maintenance", async () => {
    await recoveryState();
    const target = "restore-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const file = path.join(directory, ".data", "users.json");
    const activeFile = path.join(directory, ".data", "recovery", "datasets", target, "users.json");
    await mkdir(path.dirname(activeFile), { recursive: true });
    await writeFile(activeFile, JSON.stringify([{ id: "restored-user" }]));
    await changeControl<RecoveryState>("state", (state) => ({ ...state, mode: "ready", active: target }));
    expect(JSON.parse(await dataFs.readFile(file, "utf8"))[0].id).toBe("restored-user");
    await writeJsonAtomic(file, [{ id: "new-user" }]);
    expect(JSON.parse(await readFile(activeFile, "utf8"))[0].id).toBe("new-user");
    await changeControl<RecoveryState>("state", (state) => ({ ...state, mode: "maintenance" }));
    await expect(writeJsonAtomic(file, [])).rejects.toMatchObject({ code: "maintenance" });
    expect(JSON.parse(await readFile(activeFile, "utf8"))).toHaveLength(1);
  });
  it("keeps an empty environment in setup and refuses ordinary data operations", async () => {
    expect((await recoveryState()).mode).toBe("setup");
    await expect(withDataset(async () => "not allowed")).rejects.toMatchObject({ code: "maintenance" });
  });
  it("accounts for an in-flight operation while maintenance prevents new operations", async () => {
    await recoveryState();
    await changeControl<RecoveryState>("state", (state) => ({ ...state, mode: "ready" }));
    let finish: () => void = () => undefined;
    let started: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const operation = withDataset(async (target) => { started(); await gate; return target; });
    await entered;
    const blocked = await changeControl<RecoveryState>("state", (state) => ({ ...state, mode: "maintenance" }));
    expect(Object.keys(blocked.activities)).toHaveLength(1);
    await expect(withDataset(async () => "second")).rejects.toMatchObject({ code: "maintenance" });
    finish();
    expect(await operation).toBe("bd");
    expect((await recoveryState()).activities).toEqual({});
  });
  it("allows only one competing control transition", async () => {
    await recoveryState();
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => changeControl<RecoveryState>("state", (state) => {
      if (state.operation) throw new Error("claimed");
      return { ...state, operation: String(index) };
    })));
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
  });
});