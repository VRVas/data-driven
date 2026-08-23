"use server";

import { requirePermission } from "@/lib/auth/authorize";
import { getConversationStore, type ConversationHeader, type Conversation } from "@/lib/copilot/threads";

/** Recent conversations for the signed-in user (headers only). */
export async function listConversations(): Promise<ConversationHeader[]> {
  const { user } = await requirePermission("copilot:use");
  return getConversationStore().listForUser(user.id);
}

/** Load a full conversation (messages) - scoped to the owner. */
export async function loadConversation(id: string): Promise<Conversation | null> {
  const { user } = await requirePermission("copilot:use");
  return getConversationStore().get(id, user.id);
}

export async function deleteConversation(id: string): Promise<{ ok: boolean }> {
  const { user } = await requirePermission("copilot:use");
  await getConversationStore().remove(id, user.id);
  return { ok: true };
}
