import "server-only";
import { randomUUID } from "node:crypto";
import { getReminderStore, type Reminder } from "@/lib/store/reminders";
import { getNotificationStore } from "@/lib/store/notifications";
import { getBrandStore } from "@/lib/store/brands";
import { getNoteStore } from "@/lib/store/notes";
import { getCrmOverlayStore } from "@/lib/store/crm";
import { getEmailProvider } from "@/lib/mail/provider";
import { dealValue, latestProposal, rollupFor } from "@/lib/crm/logic";
import { migrateBrands } from "@/lib/crm/migrate";
import { healthOf } from "@/lib/pipeline/health";
import { priorityOf } from "@/lib/priority";
import { winProbability } from "@/lib/scoring";
import { logAudit } from "@/lib/store/audit";
import {
  composeReminderEmail,
  composeReminderNotification,
  type ReminderContext,
  type ReminderLeadContext,
} from "./compose";
import type { Deal } from "@/lib/crm/types";

/**
 * Delivering reminders.
 *
 * Called from the scheduled route and from the action that fires one
 * immediately, so "send now" and "send at 9am" take exactly the same path -
 * the alternative is two delivery implementations that disagree the first time
 * one is changed.
 *
 * Claiming is the important part. A due reminder is flipped to "sending"
 * before anything leaves, and only rows still at "scheduled" are picked up, so
 * a second replica running the same minute finds nothing to do.
 */

const prob = (d: Pick<Deal, "stage" | "dealType">) =>
  winProbability((d.dealType === "Recurring" ? "Recurring" : d.stage) as never);

const appUrl = (): string | null => process.env.APP_URL?.replace(/\/$/, "") ?? null;
const senderAddress = (): string => process.env.ACS_SENDER_ADDRESS ?? "reminders@localhost";

/** Everything the email is allowed to claim about the lead, gathered once. */
export async function leadContextFor(brandId: string): Promise<ReminderLeadContext | null> {
  const brand = await getBrandStore().get(brandId);
  if (!brand) return null;

  const overlay = await getCrmOverlayStore().read();
  const proposals = overlay.proposals.filter((p) => p.dealId === brandId);
  const { deals } = migrateBrands([brand], prob);
  const deal = deals[0];

  const value = dealValue(deal, proposals);
  const health = healthOf(brand, proposals);
  const p = priorityOf(brand);
  const proposal = latestProposal(proposals);

  // The company as the app projects it, including any deals linked to it.
  const link = overlay.links.find((l) => l.dealId === brandId);
  const companyId = link?.companyId ?? deal.companyId;
  const companyName = link?.companyName ?? deal.companyName;
  const siblingIds = new Set(overlay.links.filter((l) => l.companyId === companyId).map((l) => l.dealId));
  siblingIds.add(brandId);
  const siblings = (await getBrandStore().list()).filter((b) => siblingIds.has(b.id));
  const rollup = rollupFor(migrateBrands(siblings, prob).deals, prob, overlay.proposals);

  // A store that is unavailable costs the email its thread, not the email.
  const notes = await getNoteStore()
    .listForLead(brandId, 3)
    .catch(() => []);

  return {
    id: brand.id,
    name: brand.name,
    status: brand.status,
    priority: brand.priority,
    owner: brand.owner,
    poc: brand.poc,
    email: brand.email,
    industry: brand.industry,
    valueEur: value.basis === "none" ? null : value.value,
    valueBasis: value.basis === "none" ? null : value.basis,
    priorityScore: p?.priority ?? null,
    grade: p?.grade ?? null,
    quadrant: p?.quadrant ?? null,
    waitingOn: health.waitingOn,
    waitingInferred: health.source !== "explicit",
    daysLate: health.daysLate,
    nextStep: brand.nextStep ?? null,
    lastContact: brand.lastContact,
    followUpDate: brand.followUpDate,
    notes: brand.notes,
    recentNotes: notes.map((n) => ({ author: n.authorName, at: n.createdAt, body: n.body })),
    company: {
      name: companyName,
      openPipelineEur: rollup.openPipelineValue,
      lifetimeEur: rollup.lifetimeValue,
      dealCount: siblings.length,
    },
    latestProposal: proposal
      ? { valueEur: proposal.value, status: proposal.status, sentAt: proposal.sentAt }
      : null,
  };
}

export async function contextFor(reminder: Reminder): Promise<ReminderContext> {
  return {
    reminder,
    lead: reminder.brandId ? await leadContextFor(reminder.brandId) : null,
    appUrl: appUrl(),
    senderAddress: senderAddress(),
  };
}

export interface DeliveryResult {
  id: string;
  ok: boolean;
  inApp: boolean;
  emailed: boolean;
  error?: string;
}

/**
 * Deliver one reminder that has already been claimed.
 *
 * The in-app notification is written first and independently of the email: a
 * bounced address should not also cost the user the notification, which is the
 * half that always works.
 */
export async function deliver(reminder: Reminder): Promise<DeliveryResult> {
  const store = getReminderStore();
  const ctx = await contextFor(reminder);
  let inApp = false;
  let emailed = false;
  let error: string | undefined;

  if (reminder.channels.inApp) {
    const note = composeReminderNotification(ctx);
    await getNotificationStore().create({
      id: `ntf-${randomUUID()}`,
      userId: reminder.ownerId,
      kind: "reminder",
      title: note.title,
      body: note.body,
      href: note.href,
      sourceId: reminder.id,
      readAt: null,
      createdAt: new Date().toISOString(),
    });
    inApp = true;
  }

  if (reminder.channels.email) {
    const mail = composeReminderEmail(ctx);
    const result = await getEmailProvider().send({
      to: reminder.ownerEmail,
      toName: reminder.ownerName,
      subject: mail.subject,
      body: mail.body,
      attachments: mail.attachments,
    });
    emailed = result.ok;
    if (!result.ok) error = result.error ?? "send failed";
  }

  const ok = error === undefined;
  const now = new Date().toISOString();
  await store.update({
    ...reminder,
    status: ok ? "sent" : "failed",
    sentAt: ok ? now : reminder.sentAt,
    error: error ?? null,
    attempts: reminder.attempts + 1,
    updatedAt: now,
  });

  await logAudit({
    actorId: reminder.createdById,
    actorName: reminder.createdByName,
    action: ok ? "reminder.sent" : "reminder.failed",
    entity: "reminder",
    entityId: reminder.id,
    summary: `${ok ? "Delivered" : "Failed to deliver"} reminder "${reminder.title}" to ${reminder.ownerName}`,
  });

  return { id: reminder.id, ok, inApp, emailed, error };
}

/**
 * Claim a reminder for delivery.
 *
 * Returns null when somebody else already has it. The read-then-write is not
 * atomic, which is why the claim is narrow: a lost race means one duplicate at
 * worst, and only between replicas dispatching in the same second.
 */
export async function claim(id: string): Promise<Reminder | null> {
  const store = getReminderStore();
  const current = await store.get(id);
  if (!current || current.status !== "scheduled") return null;

  const claimed: Reminder = { ...current, status: "sending", updatedAt: new Date().toISOString() };
  await store.update(claimed);
  return claimed;
}

export interface DispatchSummary {
  considered: number;
  delivered: number;
  failed: number;
  results: DeliveryResult[];
}

/** Deliver everything due. Safe to call as often as you like. */
export async function dispatchDueReminders(now: Date = new Date(), limit = 50): Promise<DispatchSummary> {
  const due = await getReminderStore().listDue(now.toISOString(), limit);
  const results: DeliveryResult[] = [];

  for (const reminder of due) {
    const claimed = await claim(reminder.id);
    if (!claimed) continue;
    try {
      results.push(await deliver(claimed));
    } catch (err) {
      results.push({
        id: reminder.id,
        ok: false,
        inApp: false,
        emailed: false,
        error: err instanceof Error ? err.message : "delivery failed",
      });
    }
  }

  return {
    considered: due.length,
    delivered: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
