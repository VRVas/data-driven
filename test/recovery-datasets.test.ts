import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emptyContainer, readDataset, writeDataset, verifyDataset } from "@/lib/recovery/datasets";
import { prepareImport } from "@/lib/recovery/policy";
import { hashPassword } from "@/lib/auth/password";
import type { BackupContainer } from "@/lib/recovery/package";

let directory: string;
let cwd: string;
beforeEach(async () => { cwd = process.cwd(); directory = await mkdtemp(path.join(os.tmpdir(), "recovery-data-")); process.chdir(directory); vi.stubEnv("COSMOS_ENDPOINT", ""); });
afterEach(async () => { process.chdir(cwd); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
async function fixture(): Promise<BackupContainer[]> {
  return [{ ...emptyContainer("users"), items: [{ id: "admin", email: "admin@example.invalid", name: "Fixture Admin", role: "admin", passwordHash: await hashPassword("Fixture12345!") }] },
    { ...emptyContainer("brands"), items: [{ id: "lead", name: "Fixture Lead", owner: "Fixture Admin" }] },
    { ...emptyContainer("notes"), items: [{ id: "note", leadId: "lead", body: "Fixture" }] }];
}
describe("staged datasets and import policy", () => {
  it("writes and verifies a staged dataset without touching the original", async () => {
    const source = await fixture();
    const prepared = prepareImport(source, "full", []);
    const target = "restore-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await writeDataset(target, prepared.containers);
    await expect(verifyDataset(target, prepared.containers)).resolves.toBeUndefined();
    expect((await readDataset("bd")).every((container) => container.items.length === 0)).toBe(true);
    await expect(writeDataset("bd", prepared.containers)).rejects.toMatchObject({ code: "unsafe_target" });
  });
  it("never reactivates challenges, integration work, file references or pending sends", async () => {
    const source = await fixture();
    for (const name of ["authChallenges", "copilotIntegrations", "documents", "reminders", "outreach"]) source.push({ ...emptyContainer(name), items: [{ id: "old", status: "scheduled" }] });
    const result = prepareImport(source, "full", []);
    for (const name of ["authChallenges", "copilotIntegrations", "documents"]) expect(result.containers.find((container) => container.definition.id === name)!.items).toEqual([]);
    expect(result.containers.find((container) => container.definition.id === "reminders")!.items[0].status).toBe("cancelled");
    expect(result.changes.length).toBe(5);
  });
  it("rejects orphan lead references and administrator lockout", async () => {
    const source = await fixture();
    source.find((container) => container.definition.id === "notes")!.items[0].leadId = "missing";
    expect(() => prepareImport(source, "full", [])).toThrow("absent from the package");
    expect(() => prepareImport([emptyContainer("brands")], "full", [])).toThrow("administrator");
  });
  it("keeps current users and audit in a CRM-only reset", async () => {
    const source = await fixture();
    const current = await fixture();
    current[0].items[0].name = "Current Admin";
    const result = prepareImport(source, "crm", current);
    expect(result.containers.find((container) => container.definition.id === "users")!.items[0].name).toBe("Current Admin");
    expect(result.containers.find((container) => container.definition.id === "notes")!.items[0].id).toBe("note");
  });
});