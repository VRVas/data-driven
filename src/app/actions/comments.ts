"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/authorize";
import { writableLead } from "@/lib/leads/visible";
import { getCommentStore, type Comment } from "@/lib/store/comments";
import { logAudit } from "@/lib/store/audit";

/**
 * Comments on a lead.
 *
 * Adding one is a separate permission from editing the lead, because they are
 * different acts: recording what a client said is not the same authority as
 * changing what the deal is worth. Removing somebody else's is separate again,
 * and your own is always yours to take back.
 */
export type CommentActionState = { ok?: boolean; error?: string } | undefined;

const addSchema = z.object({
  leadId: z.string().trim().min(1),
  body: z.string().trim().min(1, "Write something first").max(4000),
});

export async function addComment(
  _prev: CommentActionState,
  formData: FormData,
): Promise<CommentActionState> {
  const auth = await requirePermission("lead:comment");
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };

  const lead = await writableLead(parsed.data.leadId, "lead:comment");
  if (!lead) return { error: "Lead not found." };

  const comment: Comment = {
    id: `cmt-${randomUUID()}`,
    target: "lead",
    recordId: lead.id,
    recordName: lead.name,
    body: parsed.data.body,
    authorId: auth.user.id,
    authorName: auth.user.name,
    createdAt: new Date().toISOString(),
    editedAt: null,
  };
  await getCommentStore().create(comment);

  await logAudit({
    actorId: auth.user.id,
    actorName: auth.user.name,
    action: "lead.comment",
    entity: "brand",
    entityId: lead.id,
    summary: `Commented on ${lead.name}`,
  });

  revalidatePath(`/dashboard/pipeline/${lead.id}`);
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

export async function deleteComment(
  _prev: CommentActionState,
  formData: FormData,
): Promise<CommentActionState> {
  const leadId = String(formData.get("leadId") ?? "");
  const id = String(formData.get("id") ?? "");
  if (!leadId || !id) return { error: "Nothing to remove." };

  // Read first: whether this needs the wider permission depends on who wrote
  // it, so the cheaper check cannot come first.
  const store = getCommentStore();
  const comment = await store.get(id, leadId);
  if (!comment) return { error: "That comment is already gone." };

  const own = await requirePermission("lead:comment");
  if (comment.authorId !== own.user.id) await requirePermission("lead:comment:delete");

  const lead = await writableLead(leadId, "lead:comment");
  if (!lead) return { error: "Lead not found." };

  await store.remove(id, leadId);
  await logAudit({
    actorId: own.user.id,
    actorName: own.user.name,
    action: "lead.comment.delete",
    entity: "brand",
    entityId: lead.id,
    summary: `Removed ${comment.authorId === own.user.id ? "their own" : `${comment.authorName}'s`} comment on ${lead.name}`,
  });

  revalidatePath(`/dashboard/pipeline/${lead.id}`);
  return { ok: true };
}
