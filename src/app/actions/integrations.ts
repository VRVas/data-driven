"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/authorize";
import { startLink, confirmLink, disconnectTelegram } from "@/lib/copilot/external/telegram-link";
import { IntegrationError } from "@/lib/copilot/external/contracts";
import { logAudit } from "@/lib/store/audit";

export type IntegrationActionState = { error?: string; url?: string; expiresAt?: string; ok?: boolean } | undefined;
const failure = (error: unknown): IntegrationActionState => ({ error: error instanceof IntegrationError ? error.message : "The connection could not be updated. Please retry." });

export async function createTelegramLink(): Promise<IntegrationActionState> {
  const { user } = await requirePermission("copilot:use");
  try { return await startLink(user.id); }
  catch (error) { return failure(error); }
}

export async function confirmTelegramLink(_previous: IntegrationActionState, form: FormData): Promise<IntegrationActionState> {
  const { user } = await requirePermission("copilot:use");
  try {
    const candidate = String(form.get("candidateId") ?? "");
    if (!/^\d{1,20}$/.test(candidate)) return { error: "Invalid Telegram account." };
    await confirmLink(user.id, candidate);
    await logAudit({ actorId: user.id, actorName: user.name, action: "integration.link", entity: "copilot", entityId: candidate, summary: "Linked Telegram account" });
    revalidatePath("/dashboard/copilot/integrations");
    return { ok: true };
  } catch (error) { return failure(error); }
}

export async function revokeTelegramLink(): Promise<IntegrationActionState> {
  const { user } = await requirePermission("copilot:use");
  try {
    await disconnectTelegram(user.id);
    await logAudit({ actorId: user.id, actorName: user.name, action: "integration.unlink", entity: "copilot", entityId: user.id, summary: "Disconnected Telegram account" });
    revalidatePath("/dashboard/copilot/integrations");
    return { ok: true };
  } catch (error) { return failure(error); }
}