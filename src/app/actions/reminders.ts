"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/authorize";
import { getBrandStore } from "@/lib/store/brands";
import { authorizeLead } from "@/lib/leads/visible";
import { logAudit } from "@/lib/store/audit";
import { addDays, todayYmd } from "@/lib/workflow";

export type ReminderActionState = { ok?: boolean; error?: string } | undefined;

const snoozeSchema = z.object({
  id: z.string().min(1),
  days: z.coerce.number().int().min(1).max(90),
});

/** Push a lead's follow-up out by N days from today. */
export async function snoozeFollowUp(_prev: ReminderActionState, formData: FormData): Promise<ReminderActionState> {
  const auth = await requirePermission("reminder:update");
  const { user } = auth;
  const parsed = snoozeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid snooze." };
  const { id, days } = parsed.data;

  const store = getBrandStore();
  const brand = await store.get(id);
  if (!brand) return { error: "That lead no longer exists." };
  await authorizeLead(auth, brand);

  const next = addDays(todayYmd(), days);
  await store.save({ ...brand, followUpDate: next });
  await logAudit({
    actorId: user.id,
    actorName: user.name,
    action: "reminder.snooze",
    entity: "brand",
    entityId: id,
    summary: `Snoozed ${brand.name} follow-up to ${next}`,
  });

  revalidatePath("/dashboard/reminders");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/pipeline");
  revalidatePath(`/dashboard/pipeline/${id}`);
  return { ok: true };
}

/** Mark a follow-up handled: clear the date and stamp today as last contact. */
export async function completeFollowUp(_prev: ReminderActionState, formData: FormData): Promise<ReminderActionState> {
  const auth = await requirePermission("reminder:complete");
  const { user } = auth;
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing id." };

  const store = getBrandStore();
  const brand = await store.get(id);
  if (!brand) return { error: "That lead no longer exists." };
  await authorizeLead(auth, brand);

  await store.save({ ...brand, followUpDate: null, lastContact: todayYmd() });
  await logAudit({
    actorId: user.id,
    actorName: user.name,
    action: "reminder.done",
    entity: "brand",
    entityId: id,
    summary: `Completed follow-up for ${brand.name}`,
  });

  revalidatePath("/dashboard/reminders");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/pipeline");
  revalidatePath(`/dashboard/pipeline/${id}`);
  return { ok: true };
}
