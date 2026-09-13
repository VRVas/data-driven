"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/authorize";
import { writableLead } from "@/lib/leads/visible";
import { getNoteStore, type NoteEntry } from "@/lib/store/notes";
import { logAudit } from "@/lib/store/audit";

/**
 * Adding to a lead's notes.
 *
 * Guarded by `lead:update` rather than a permission of its own: the notes are
 * part of the record, and anyone trusted to change what the deal is worth is
 * trusted to write down why. `writableLead` applies the record scope, so an
 * own-only account can only annotate its own leads.
 */
export type NoteActionState = { ok?: boolean; error?: string } | undefined;

const schema = z.object({
  leadId: z.string().trim().min(1),
  body: z.string().trim().min(1, "Write something first").max(4000),
});

export async function appendNote(
  _prev: NoteActionState,
  formData: FormData,
): Promise<NoteActionState> {
  const auth = await requirePermission("lead:update");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };

  const lead = await writableLead(parsed.data.leadId, "lead:update");
  if (!lead) return { error: "Lead not found." };

  const entry: NoteEntry = {
    id: `note-${randomUUID()}`,
    leadId: lead.id,
    body: parsed.data.body,
    authorId: auth.user.id,
    authorName: auth.user.name,
    createdAt: new Date().toISOString(),
  };
  await getNoteStore().append(entry);

  await logAudit({
    actorId: auth.user.id,
    actorName: auth.user.name,
    action: "lead.note",
    entity: "brand",
    entityId: lead.id,
    summary: `Added a note to ${lead.name}`,
  });

  revalidatePath(`/dashboard/pipeline/${lead.id}`);
  return { ok: true };
}
