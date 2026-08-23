import "server-only";
import { getOutreachStore } from "@/lib/store/outreach";
import { getBrandStore } from "@/lib/store/brands";
import { getEmailProvider } from "@/lib/mail/provider";
import { authorizeLead } from "@/lib/leads/visible";
import { logAudit } from "@/lib/store/audit";
import { todayYmd } from "@/lib/workflow";
import type { Authorized } from "@/lib/auth/authorize";
import type { Outreach } from "@/lib/store/outreach";

export interface SendResult {
  ok: boolean;
  error?: string;
  record?: Outreach;
  provider?: string;
}

/**
 * Send an outreach message that already exists.
 *
 * Shared by the outbox screen and the copilot so there is one send path, not
 * two that drift. Takes an existing record rather than an address and a body:
 * the draft → review → send flow is the control, and a tool that composed and
 * sent in one step would walk straight around it.
 *
 * The caller must already hold outreach:send - this does not check it, because
 * the permission belongs at the entry point where refusing is meaningful.
 */
export async function sendExistingOutreach(auth: Authorized, id: string): Promise<SendResult> {
  const store = getOutreachStore();
  const record = await store.get(id);
  if (!record) return { ok: false, error: "That message no longer exists." };
  if (record.status === "sent") return { ok: true, record };
  if (record.status === "cancelled") return { ok: false, error: "This message was cancelled." };

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
    approvedById: auth.user.id,
    approvedByName: auth.user.name,
    updatedAt: new Date().toISOString(),
  };
  await store.update(updated);

  // Sending counts as a touch - refresh the lead's last-contact date.
  if (result.ok && brand) await getBrandStore().save({ ...brand, lastContact: todayYmd() });

  await logAudit({
    actorId: auth.user.id,
    actorName: auth.user.name,
    action: result.ok ? "outreach.send" : "outreach.fail",
    entity: "outreach",
    entityId: record.id,
    summary: result.ok
      ? `Sent outreach to ${record.brandName} via ${result.provider}`
      : `Failed to send outreach to ${record.brandName}: ${result.error ?? "unknown"}`,
  });

  return result.ok
    ? { ok: true, record: updated, provider: result.provider }
    : { ok: false, error: result.error ?? "unknown error", record: updated };
}
