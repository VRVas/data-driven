import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getUserStore } from "@/lib/store/users";
import { storedUserPrincipal } from "@/lib/copilot/external/auth";
import { verifyPassword } from "@/lib/auth/password";
import { can } from "@/lib/auth/effective";
import { recoveryEnabled } from "./backend";
import { changeControl, controlRecord, readControl, recoveryState, saveControl, withDataset, type ControlRecord } from "./control";
import { RecoveryError, sha256 } from "./package";
import type { RecoveryActor } from "./jobs";

export type RecoveryPermission = "data:backup" | "data:restore";
export const recoveryCookie = () => process.env.NODE_ENV === "production" ? "__Host-oovie-recovery" : "oovie-recovery";
interface RecoverySession extends ControlRecord { kind: "session"; actor: RecoveryActor; permissions: RecoveryPermission[]; expiresAt: string; epoch: number; credentialHash: string }
export const loginSchema = z.union([
  z.object({ recoveryKey: z.string().min(32).max(512) }).strict(),
  z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(512) }).strict(),
]);
export function sameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const configured = process.env.APP_URL ? new URL(process.env.APP_URL).origin : new URL(request.url).origin;
  if (!origin || origin !== configured) throw new RecoveryError("invalid_origin", "This request must originate from the application.", 403);
}
export async function recoveryRateLimit(bucket: string, maximum: number): Promise<void> {
  const id = `rate:${bucket}:${Math.floor(Date.now() / 60000)}`;
  type Counter = ControlRecord & { count: number };
  if (await saveControl<Counter>({ ...controlRecord("rate", id), count: 1, ttl: 120 })) return;
  await changeControl<Counter>(id, (record) => {
    if (record.count >= maximum) throw new RecoveryError("rate_limited", "Too many attempts. Try again in one minute.", 429);
    return { ...record, count: record.count + 1 };
  });
}
export async function createRecoverySession(body: unknown): Promise<{ token: string; session: RecoverySession }> {
  if (!recoveryEnabled()) throw new RecoveryError("recovery_disabled", "Data recovery is disabled.", 503);
  await recoveryRateLimit("login-global", 20);
  const input = loginSchema.parse(body);
  let actor: RecoveryActor;
  let permissions: RecoveryPermission[];
  let credentialHash: string;
  const state = await recoveryState();
  if ("recoveryKey" in input) {
    const configured = process.env.DATA_RECOVERY_KEY;
    if (!configured || configured.length < 32 || !timingSafeEqual(Buffer.from(sha256(configured), "hex"), Buffer.from(sha256(input.recoveryKey), "hex"))) {
      throw new RecoveryError("unauthorized", "Recovery authentication failed.", 401);
    }
    actor = { id: "environment-owner", name: "Environment recovery owner", email: "", authority: "recovery-key" };
    credentialHash = sha256(configured);
    permissions = ["data:backup", "data:restore"];
  } else {
    await recoveryRateLimit(`login:${sha256(input.email)}`, 5);
    if (state.mode !== "ready") throw new RecoveryError("recovery_key_required", "Use the environment recovery key while initialization or maintenance is active.", 403);
    const user = await withDataset(() => getUserStore().findByEmail(input.email), true);
    if (!user || user.active === false || !(await verifyPassword(input.password, user.passwordHash))) throw new RecoveryError("unauthorized", "Recovery authentication failed.", 401);
    const principal = await withDataset(() => storedUserPrincipal(user.id), true);
    permissions = (["data:backup", "data:restore"] as const).filter((permission) => can(principal.effective, permission));
    if (!permissions.length) throw new RecoveryError("forbidden", "This account cannot manage database recovery.", 403);
    actor = { id: user.id, name: user.name, email: user.email, authority: "administrator" };
    credentialHash = sha256(user.passwordHash);
  }
  const token = randomBytes(32).toString("base64url");
  const session: RecoverySession = { ...controlRecord("session", `session:${sha256(token)}`), kind: "session", actor, permissions,
    epoch: state.epoch, credentialHash, expiresAt: new Date(Date.now() + 30 * 60000).toISOString(), ttl: 1800 };
  await saveControl(session);
  return { token, session };
}
export async function recoveryPermission(permission: RecoveryPermission, request: Request): Promise<RecoverySession> {
  if (!recoveryEnabled()) throw new RecoveryError("recovery_disabled", "Data recovery is disabled.", 503);
  if (!["GET", "HEAD"].includes(request.method)) sameOrigin(request);
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${recoveryCookie()}=`))?.slice(recoveryCookie().length + 1);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new RecoveryError("unauthorized", "Reauthenticate to open Data & Recovery.", 401);
  const session = await readControl<RecoverySession>(`session:${sha256(token)}`);
  if (!session || session.kind !== "session" || Date.parse(session.expiresAt) <= Date.now()) throw new RecoveryError("unauthorized", "Your recovery session expired. Reauthenticate.", 401);
  if (!session.permissions.includes(permission)) throw new RecoveryError("forbidden", "This recovery session lacks the required permission.", 403);
  await recoveryRateLimit(`session:${session.id}`, request.method === "GET" ? 120 : 20);
  if (session.actor.authority === "recovery-key") {
    if (!process.env.DATA_RECOVERY_KEY || session.credentialHash !== sha256(process.env.DATA_RECOVERY_KEY)) throw new RecoveryError("unauthorized", "The recovery key changed. Reauthenticate.", 401);
  } else {
    const state = await recoveryState();
    if (state.epoch !== session.epoch) throw new RecoveryError("unauthorized", "The dataset changed. Reauthenticate with a current account or the recovery key.", 401);
    if (state.mode === "ready") {
      await withDataset(async () => {
        const user = await getUserStore().findById(session.actor.id);
        if (!user || user.active === false || session.credentialHash !== sha256(user.passwordHash)) throw new RecoveryError("unauthorized", "Recovery access was revoked. Reauthenticate.", 401);
        const principal = await storedUserPrincipal(user.id);
        if (!can(principal.effective, permission)) throw new RecoveryError("forbidden", "This account no longer has the required recovery permission.", 403);
      }, true);
    }
  }
  return session;
}
export function recoveryFailure(error: unknown): Response {
  if (error instanceof RecoveryError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers: { "cache-control": "no-store" } });
  if (error instanceof z.ZodError) return Response.json({ error: { code: "invalid_request", message: "Check the supplied values." } }, { status: 400 });
  console.error("[recovery] request failed", { name: error instanceof Error ? error.name : "UnknownError" });
  return Response.json({ error: { code: "recovery_unavailable", message: "Recovery is unavailable. Check storage and identity configuration." } }, { status: 503 });
}