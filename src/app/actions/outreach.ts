"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requirePermission } from "@/lib/auth/authorize";
import { can } from "@/lib/auth/effective";
import { getBrandStore } from "@/lib/store/brands";
import { authorizeLead } from "@/lib/leads/visible";
import { getOutreachStore, type Outreach } from "@/lib/store/outreach";
import { getEmailProvider } from "@/lib/mail/provider";
import { logAudit } from "@/lib/store/audit";
import { todayYmd } from "@/lib/workflow";

export type OutreachActionState = { ok?: boolean; error?: string } | undefined;

const composeSchema = z.object({
  brandId: z.string().min(1),
  to: z.string().trim().email("Enter a valid recipient email"),
  subject: z.string().trim().min(1, "Subject is required").max(200),
  body: z.string().trim().min(1, "Message is required").max(8000),
  templateId: z.string().trim().max(40).optional().default("intro"),
});

/**
 * Draft an outreach email. Admins create a ready-to-send draft; members submit
 * it for approval. Sending happens in `sendOutreach` (admin-gated).
 */
export async function composeOutreach(_prev: OutreachActionState, formData: FormData): Promise<OutreachActionState> {
  const ctx = await requirePermission("outreach:compose");
  const { user } = ctx;
  // Whoever may approve is trusted to hold their own draft; everyone else queues for review.
  const canApprove = can(ctx.effective, "outreach:approve");
  const parsed = composeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const input = parsed.data;

  const brand = await getBrandStore().get(input.brandId);
  if (!brand) return { error: "That lead no longer exists." };
  await authorizeLead(ctx, brand);

  const now = new Date().toISOString();
  const record: Outreach = {
    id: randomUUID(),
    brandId: brand.id,
    brandName: brand.name,
    to: input.to,
    subject: input.subject,
    body: input.body,
    templateId: input.templateId,
    status: canApprove ? "draft" : "pending_approval",
    createdById: user.id,
    createdByName: user.name,
    createdAt: now,
    updatedAt: now,
  };
  await getOutreachStore().create(record);
  await logAudit({
    actorId: user.id,
    actorName: user.name,
    action: "outreach.create",
    entity: "outreach",
    entityId: record.id,
    summary: canApprove
      ? `Drafted outreach to ${brand.name}`
      : `Submitted outreach to ${brand.name} for approval`,
  });

  revalidatePath("/dashboard/outbox");
  revalidatePath(`/dashboard/pipeline/${brand.id}`);
  return { ok: true };
}

/** Approve (if needed) and send an outreach message. Admin-only. */
export async function sendOutreach(_prev: OutreachActionState, formData: FormData): Promise<OutreachActionState> {
  const auth = await requirePermission("outreach:send");
  const { user: admin } = auth;
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing id." };

  const store = getOutreachStore();
  const record = await store.get(id);
  if (!record) return { error: "That message no longer exists." };
  if (record.status === "sent") return { ok: true };
  if (record.status === "cancelled") return { error: "This message was cancelled." };

  // Before the send, not after: an email cannot be recalled once it has gone.
  const brand = await getBrandStore().get(record.brandId);
  if (brand) await authorizeLead(auth, brand);

  const result = await getEmailProvider().send({
    to: record.to,
    subject: record.subject,
    body: record.body,
  });

  const updated: Outreach = {
    ...record,
    status: result.ok ? "sent" : "failed",
    provider: result.provider,
    providerMessageId: result.messageId,
    error: result.ok ? undefined : result.error,
    approvedById: admin.id,
    approvedByName: admin.name,
    updatedAt: new Date().toISOString(),
  };
  await store.update(updated);

  if (result.ok) {
    // Sending counts as a touch — refresh the lead's last-contact date.
    if (brand) await getBrandStore().save({ ...brand, lastContact: todayYmd() });
  }

  await logAudit({
    actorId: admin.id,
    actorName: admin.name,
    action: result.ok ? "outreach.send" : "outreach.fail",
    entity: "outreach",
    entityId: record.id,
    summary: result.ok
      ? `Sent outreach to ${record.brandName} via ${result.provider}`
      : `Failed to send outreach to ${record.brandName}: ${result.error ?? "unknown"}`,
  });

  revalidatePath("/dashboard/outbox");
  revalidatePath(`/dashboard/pipeline/${record.brandId}`);
  revalidatePath("/dashboard");
  return result.ok ? { ok: true } : { error: `Send failed: ${result.error ?? "unknown error"}` };
}

/** Cancel a draft / pending message. Admins, or the person who created it. */
export async function cancelOutreach(_prev: OutreachActionState, formData: FormData): Promise<OutreachActionState> {
  const ctx = await requirePermission("outreach:cancel");
  const { user } = ctx;
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing id." };

  const store = getOutreachStore();
  const record = await store.get(id);
  if (!record) return { error: "That message no longer exists." };
  if (record.status === "sent") return { error: "Sent messages can't be cancelled." };
  if (!can(ctx.effective, "outreach:approve") && record.createdById !== user.id) {
    return { error: "You can only cancel your own drafts." };
  }

  await store.update({ ...record, status: "cancelled", updatedAt: new Date().toISOString() });
  await logAudit({
    actorId: user.id,
    actorName: user.name,
    action: "outreach.cancel",
    entity: "outreach",
    entityId: record.id,
    summary: `Cancelled outreach to ${record.brandName}`,
  });

  revalidatePath("/dashboard/outbox");
  revalidatePath(`/dashboard/pipeline/${record.brandId}`);
  return { ok: true };
}
