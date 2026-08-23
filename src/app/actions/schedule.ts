"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/authorize";
import { getReminderStore, type Reminder } from "@/lib/store/reminders";
import { getNotificationStore } from "@/lib/store/notifications";
import { visibleLead } from "@/lib/leads/visible";
import { getEmailProvider } from "@/lib/mail/provider";
import { claim, contextFor, deliver } from "@/lib/reminders/dispatch";
import { composeReminderCancellation } from "@/lib/reminders/compose";
import { logAudit } from "@/lib/store/audit";

/**
 * Creating, firing and cancelling a reminder somebody set on purpose.
 *
 * A reminder is always for the person who created it. There is no "remind
 * someone else": that is a message, it would arrive without context or
 * consent, and it is a different feature.
 */
export type ScheduleActionState = { ok?: boolean; error?: string; id?: string } | undefined;

const createSchema = z.object({
  title: z.string().trim().min(1, "Give the reminder a title").max(160),
  topic: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(400).optional()),
  notes: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(4000).optional()),
  brandId: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().optional()),
  // Local datetime from the form, or "now" to fire immediately.
  dueAt: z.string().trim().min(1, "Say when"),
  inApp: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  email: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  holdMinutes: z.preprocess(
    (v) => (v === "" || v == null || v === "0" ? undefined : v),
    z.coerce.number().int().min(5).max(480).optional(),
  ),
});

function parseDue(raw: string): Date | null {
  if (raw === "now") return new Date();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function createReminder(
  _prev: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const auth = await requirePermission("reminder:create");
  const { user } = auth;

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const input = parsed.data;

  if (!input.inApp && !input.email) return { error: "Pick at least one way to be reminded." };

  const due = parseDue(input.dueAt);
  if (!due) return { error: "That date could not be read." };

  // The lead is re-resolved through the viewer's scope: an id typed into a
  // form proves nothing about who may see it.
  let brandName: string | null = null;
  if (input.brandId) {
    const lead = await visibleLead(input.brandId);
    if (!lead) return { error: "That lead was not found." };
    brandName = lead.name;
  }

  if (!user.email) return { error: "Your account has no email address to send to." };

  const now = new Date().toISOString();
  const reminder: Reminder = {
    id: `rem-${randomUUID()}`,
    ownerId: user.id,
    ownerName: user.name,
    ownerEmail: user.email,
    title: input.title,
    topic: input.topic ?? null,
    notes: input.notes ?? null,
    brandId: input.brandId ?? null,
    brandName,
    dueAt: due.toISOString(),
    channels: { inApp: input.inApp, email: input.email },
    holdMinutes: input.holdMinutes ?? null,
    status: "scheduled",
    sequence: 0,
    sentAt: null,
    error: null,
    attempts: 0,
    createdById: user.id,
    createdByName: user.name,
    createdAt: now,
    updatedAt: now,
  };

  await getReminderStore().create(reminder);
  await logAudit({
    actorId: user.id,
    actorName: user.name,
    action: "reminder.create",
    entity: "reminder",
    entityId: reminder.id,
    summary: `Set a reminder "${reminder.title}" for ${reminder.dueAt.slice(0, 16).replace("T", " ")}`,
  });

  // Due now means due now: the same delivery path a scheduled one takes later,
  // so "send instantly" cannot behave differently from "send at nine".
  if (due.getTime() <= Date.now()) {
    const claimed = await claim(reminder.id);
    if (claimed) await deliver(claimed);
  }

  revalidatePath("/dashboard/reminders");
  revalidatePath("/dashboard");
  return { ok: true, id: reminder.id };
}

/** Withdraw a scheduled reminder, releasing any calendar time it held. */
export async function cancelReminder(
  _prev: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const auth = await requirePermission("reminder:update");
  const { user } = auth;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Missing id." };

  const store = getReminderStore();
  const reminder = await store.get(id);
  if (!reminder) return { error: "That reminder no longer exists." };
  // Ownership, not scope: a reminder is personal, so only its owner touches it.
  if (reminder.ownerId !== user.id) return { error: "That reminder is not yours." };
  if (reminder.status === "cancelled") return { ok: true, id };

  await store.update({ ...reminder, status: "cancelled", updatedAt: new Date().toISOString() });

  // Only worth withdrawing if an invitation actually went out.
  if (reminder.holdMinutes && reminder.status === "sent" && reminder.channels.email) {
    const mail = composeReminderCancellation(await contextFor(reminder));
    await getEmailProvider().send({
      to: reminder.ownerEmail,
      toName: reminder.ownerName,
      subject: mail.subject,
      body: mail.body,
      attachments: mail.attachments,
    });
  }

  await logAudit({
    actorId: user.id,
    actorName: user.name,
    action: "reminder.cancel",
    entity: "reminder",
    entityId: id,
    summary: `Cancelled reminder "${reminder.title}"`,
  });

  revalidatePath("/dashboard/reminders");
  return { ok: true, id };
}

/** Mark a delivered reminder dealt with, so it stops sitting in the list. */
export async function completeReminder(
  _prev: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const auth = await requirePermission("reminder:complete");
  const { user } = auth;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Missing id." };

  const store = getReminderStore();
  const reminder = await store.get(id);
  if (!reminder) return { error: "That reminder no longer exists." };
  if (reminder.ownerId !== user.id) return { error: "That reminder is not yours." };

  await store.update({ ...reminder, status: "done", updatedAt: new Date().toISOString() });
  revalidatePath("/dashboard/reminders");
  return { ok: true, id };
}

export type NotificationActionState = { ok?: boolean; error?: string } | undefined;

/** Dismiss one in-app notification. */
export async function markNotificationRead(
  _prev: NotificationActionState,
  formData: FormData,
): Promise<NotificationActionState> {
  const auth = await requirePermission("reminder:read");
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Missing id." };

  await getNotificationStore().markRead(id, auth.user.id);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/reminders");
  return { ok: true };
}

/** Dismiss everything unread. */
export async function markAllNotificationsRead(
  _prev: NotificationActionState,
  _formData: FormData,
): Promise<NotificationActionState> {
  const auth = await requirePermission("reminder:read");
  await getNotificationStore().markAllRead(auth.user.id);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/reminders");
  return { ok: true };
}
