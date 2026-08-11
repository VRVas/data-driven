"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/authorize";
import { getViewStore } from "@/lib/store/views";

export type ViewActionState = { ok?: boolean; error?: string } | undefined;

const createSchema = z.object({
  name: z.string().trim().min(1, "Name your view").max(40),
  q: z.string().trim().max(120).optional().default(""),
  status: z.string().trim().max(40).optional().default("All"),
  owner: z.string().trim().max(80).optional().default("All"),
  sortKey: z.string().trim().max(20).optional().default("name"),
  sortDir: z.coerce.number().optional().default(1),
});

export async function createView(_prev: ViewActionState, formData: FormData): Promise<ViewActionState> {
  const { user } = await requirePermission("view:create");
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;

  await getViewStore().create({
    userId: user.id,
    name: v.name,
    q: v.q,
    status: v.status,
    owner: v.owner,
    sortKey: v.sortKey,
    sortDir: v.sortDir === -1 ? -1 : 1,
  });

  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

export async function deleteView(_prev: ViewActionState, formData: FormData): Promise<ViewActionState> {
  const { user } = await requirePermission("view:delete");
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing id." };

  await getViewStore().remove(id, user.id);
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}
