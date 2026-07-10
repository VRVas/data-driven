"use server";

import { requireUser } from "@/lib/auth/guards";
import { getConversationStore, type ConversationHeader, type Conversation } from "@/lib/copilot/threads";

/** Recent conversations for the signed-in user (headers only). */
export async function listConversations(): Promise<ConversationHeader[]> {
  const user = await requireUser();
  return getConversationStore().listForUser(user.id);
}

/** Load a full conversation (messages) — scoped to the owner. */
export async function loadConversation(id: string): Promise<Conversation | null> {
  const user = await requireUser();
  return getConversationStore().get(id, user.id);
}

export async function deleteConversation(id: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  await getConversationStore().remove(id, user.id);
  return { ok: true };
}
