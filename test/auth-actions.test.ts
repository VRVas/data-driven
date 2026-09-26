import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { changeControl, recoveryState, withDataset, type RecoveryState } from "@/lib/recovery/control";
import { requestPasswordReset } from "@/app/actions/auth";

const mocks = vi.hoisted(() => ({ session: vi.fn(), recent: vi.fn(), issue: vi.fn(), user: vi.fn(), sendReset: vi.fn() }));
vi.mock("next-auth", () => ({ AuthError: class extends Error {} }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/auth", () => ({ auth: mocks.session, signIn: vi.fn() }));
vi.mock("@/lib/store/challenges", () => ({ getChallengeStore: () => ({
  recent: (email: string, kind: string) => withDataset(() => mocks.recent(email, kind)),
  issue: (email: string, kind: string, secret: string) => withDataset(() => mocks.issue(email, kind, secret)),
}) }));
vi.mock("@/lib/store/users", () => ({ getUserStore: () => ({ findByEmail: (email: string) => withDataset(() => mocks.user(email)) }) }));
vi.mock("@/lib/auth/notify", () => ({ sendResetLink: mocks.sendReset, sendLoginCode: vi.fn() }));

let directory: string;
beforeEach(async () => {
  vi.resetAllMocks();
  directory = await mkdtemp(path.join(os.tmpdir(), "account-recovery-actions-"));
  vi.stubEnv("APP_DATA_DIR", directory);
  vi.stubEnv("COSMOS_ENDPOINT", "");
  vi.stubEnv("DATA_RECOVERY_ENABLED", "true");
  vi.stubEnv("APP_URL", "https://fixture.example");
  mocks.recent.mockResolvedValue([]);
  mocks.issue.mockResolvedValue({ id: "fixture-challenge" });
  mocks.user.mockResolvedValue({ id: "fixture-user", name: "Fixture User", email: "fixture@example.invalid", active: true });
  mocks.sendReset.mockResolvedValue({ ok: true });
  await recoveryState();
  await changeControl<RecoveryState>("state", (state) => ({ ...state, mode: "ready", epoch: 2 }));
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe("public account recovery actions", () => {
  it.each([false, true])("can request a reset with an expired dataset session: %s", async (staleSession) => {
    mocks.session.mockResolvedValue(staleSession ? { user: { id: "old-session", dataEpoch: 1 } } : null);
    const form = new FormData();
    form.set("email", "fixture@example.invalid");
    await expect(requestPasswordReset(undefined, form)).resolves.toEqual({ notice: "If that address has an account, a message is on its way." });
    expect(mocks.sendReset).toHaveBeenCalledOnce();
    expect((await recoveryState()).activities).toEqual({});
  });
});