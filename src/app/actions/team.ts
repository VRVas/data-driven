"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/authorize";
import { getUserStore } from "@/lib/store/users";
import { logAudit } from "@/lib/store/audit";

export type TeamActionState = { ok?: boolean; error?: string } | undefined;

const schema = z.object({
  id: z.string().min(1),
  role: z.enum(["admin", "member"]),
});

/** Promote / demote a teammate. Admin-only; never strips the last admin. */
export async function setUserRole(_prev: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const { user: admin } = await requirePermission("profile:assign");

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid role change." };
  const { id, role } = parsed.data;

  const store = getUserStore();
  const users = await store.list();
  const target = users.find((u) => u.id === id);
  if (!target) return { error: "That user no longer exists." };
  if (target.role === role) return { ok: true };

  const admins = users.filter((u) => u.role === "admin");
  if (target.role === "admin" && role === "member" && admins.length <= 1) {
    return { error: "You can't demote the last admin." };
  }

  await store.setRole(id, role);
  await logAudit({
    actorId: admin.id,
    actorName: admin.name,
    action: role === "admin" ? "user.promote" : "user.demote",
    entity: "user",
    entityId: id,
    summary: `${role === "admin" ? "Promoted" : "Demoted"} ${target.name} to ${role}`,
  });

  revalidatePath("/dashboard/team");
  return { ok: true };
}
