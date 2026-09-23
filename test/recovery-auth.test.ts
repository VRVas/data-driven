import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRecoverySession, recoveryPermission, sameOrigin } from "@/lib/recovery/auth";
import { changeControl, recoveryState, type RecoveryState } from "@/lib/recovery/control";
import { hashPassword } from "@/lib/auth/password";

const mocks = vi.hoisted(() => ({ user: vi.fn(), principal: vi.fn() }));
vi.mock("@/lib/store/users", () => ({ getUserStore: () => ({ findByEmail: mocks.user, findById: mocks.user }) }));
vi.mock("@/lib/copilot/external/auth", () => ({ storedUserPrincipal: mocks.principal }));

let cwd: string;
let directory: string;
beforeEach(async () => { cwd = process.cwd(); directory = await mkdtemp(path.join(os.tmpdir(), "recovery-auth-")); process.chdir(directory);
  vi.stubEnv("DATA_RECOVERY_ENABLED", "true"); vi.stubEnv("COSMOS_ENDPOINT", ""); vi.stubEnv("DATA_RECOVERY_KEY", "fixture-recovery-key-00000000000000000"); vi.stubEnv("APP_URL", "http://localhost:3100"); });
afterEach(async () => { vi.resetAllMocks(); process.chdir(cwd); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
describe("independent recovery authentication", () => {
  it("requires a valid recovery key even before application users exist", async () => {
    await expect(createRecoverySession({ recoveryKey: "wrong-recovery-key-000000000000000000" })).rejects.toMatchObject({ status: 401 });
    const { token } = await createRecoverySession({ recoveryKey: "fixture-recovery-key-00000000000000000" });
    const request = new Request("http://localhost:3100/api/admin/recovery", { headers: { cookie: `oovie-recovery=${token}` } });
    expect((await recoveryPermission("data:restore", request)).actor.authority).toBe("recovery-key");
    await expect(recoveryPermission("data:backup", new Request(request.url))).rejects.toMatchObject({ status: 401 });
    vi.stubEnv("DATA_RECOVERY_KEY", "rotated-recovery-key-00000000000000000");
    await expect(recoveryPermission("data:restore", request)).rejects.toMatchObject({ status: 401 });
  });
  it("revokes an administrator session on permission changes and dataset replacement", async () => {
    await recoveryState();
    await changeControl<RecoveryState>("state", (state) => ({ ...state, mode: "ready" }));
    mocks.user.mockResolvedValue({ id: "admin", email: "fixture@example.invalid", name: "Fixture", active: true, passwordHash: await hashPassword("Fixture12345!") });
    mocks.principal.mockResolvedValue({ effective: { superuser: false, permissions: { "data:backup": "all", "data:restore": "all" } } });
    const { token } = await createRecoverySession({ email: "fixture@example.invalid", password: "Fixture12345!" });
    const request = new Request("http://localhost:3100/api/admin/recovery", { headers: { cookie: `oovie-recovery=${token}` } });
    expect((await recoveryPermission("data:restore", request)).actor.id).toBe("admin");
    mocks.principal.mockResolvedValue({ effective: { superuser: false, permissions: { "data:backup": "all" } } });
    await expect(recoveryPermission("data:restore", request)).rejects.toMatchObject({ status: 403 });
    await changeControl<RecoveryState>("state", (state) => ({ ...state, epoch: state.epoch + 1 }));
    await expect(recoveryPermission("data:backup", request)).rejects.toMatchObject({ status: 401 });
  });
  it("refuses cross-origin and missing-origin mutations", () => {
    expect(() => sameOrigin(new Request("http://localhost:3100", { method: "POST" }))).toThrow();
    expect(() => sameOrigin(new Request("http://localhost:3100", { method: "POST", headers: { origin: "https://attacker.invalid" } }))).toThrow();
    expect(() => sameOrigin(new Request("http://localhost:3100", { method: "POST", headers: { origin: "http://localhost:3100" } }))).not.toThrow();
  });
});