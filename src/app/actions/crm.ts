"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/authorize";
import { getCrmOverlayStore } from "@/lib/store/crm";
import { getCrmGraph } from "@/lib/crm/graph";
import { logAudit } from "@/lib/store/audit";
import type { Proposal, ProposalStatus } from "@/lib/crm/types";

export type CrmActionState = { ok?: boolean; error?: string } | undefined;

const todayIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Company linking
// ---------------------------------------------------------------------------

/**
 * Attach a deal to an existing company. This is the only way two leads ever end
 * up under one client — name similarity never does it, because "Allianz Bank"
 * and "Allianz CH" are probably different customers.
 */
export async function linkDealToCompany(_prev: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const { user } = await requirePermission("lead:update");

  const parsed = z
    .object({ dealId: z.string().min(1), companyId: z.string().min(1) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Pick a deal and a company." };
  const { dealId, companyId } = parsed.data;

  const graph = await getCrmGraph();
  const deal = graph.deals.find((d) => d.id === dealId);
  const target = graph.companies.find((c) => c.id === companyId);
  if (!deal) return { error: "That lead no longer exists." };
  if (!target) return { error: "That company no longer exists." };
  if (deal.companyId === companyId) return { ok: true };

  await getCrmOverlayStore().linkDeal({
    dealId,
    companyId,
    companyName: target.name,
    linkedById: user.id,
    linkedByName: user.name,
    linkedAt: todayIso(),
  });

  await logAudit({
    actorId: user.id,
    actorName: user.name,
    action: "company.link",
    entity: "deal",
    entityId: dealId,
    summary: `Linked ${deal.name} to ${target.name}`,
  });

  revalidatePath("/dashboard/companies");
  revalidatePath(`/dashboard/companies/${companyId}`);
  revalidatePath(`/dashboard/pipeline/${dealId}`);
  return { ok: true };
}

/** Undo a link — the deal goes back to standing on its own. */
export async function unlinkDeal(_prev: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const { user } = await requirePermission("lead:update");

  const dealId = String(formData.get("dealId") ?? "").trim();
  if (!dealId) return { error: "Missing lead." };

  // The id arrives from the form, so it has to be checked against what this
  // user can see rather than trusted.
  const graph = await getCrmGraph();
  const deal = graph.deals.find((d) => d.id === dealId);
  if (!deal) return { error: "That lead no longer exists." };

  await getCrmOverlayStore().unlinkDeal(dealId);
  await logAudit({
    actorId: user.id,
    actorName: user.name,
    action: "company.unlink",
    entity: "deal",
    entityId: dealId,
    summary: `Unlinked ${deal.name} from its company`,
  });

  revalidatePath("/dashboard/companies");
  revalidatePath(`/dashboard/pipeline/${dealId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

const PROPOSAL_STATUSES: readonly ProposalStatus[] = [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "withdrawn",
];

const proposalSchema = z.object({
  id: z.string().trim().optional(),
  dealId: z.string().min(1),
  value: z.coerce.number().min(0, "Enter a value."),
  status: z.enum(PROPOSAL_STATUSES as unknown as [string, ...string[]]),
  sentAt: z.string().trim().optional(),
  validUntil: z.string().trim().optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function saveProposal(_prev: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const { user } = await requirePermission("proposal:manage");

  const parsed = proposalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the proposal." };
  const input = parsed.data;

  const graph = await getCrmGraph();
  const deal = graph.deals.find((d) => d.id === input.dealId);
  if (!deal) return { error: "That lead no longer exists." };

  const existing = input.id ? graph.proposals.find((p) => p.id === input.id) : null;
  if (input.id && !existing) return { error: "That proposal no longer exists." };

  const status = input.status as ProposalStatus;
  const now = todayIso();
  const decided = status === "accepted" || status === "rejected" || status === "expired";
  const revision =
    existing?.revision ??
    graph.proposals.filter((p) => p.dealId === input.dealId).reduce((max, p) => Math.max(max, p.revision), 0) + 1;

  const proposal: Proposal = {
    id: existing?.id ?? `pr-${input.dealId}-${randomUUID().slice(0, 8)}`,
    type: "proposal",
    companyId: deal.companyId,
    schemaVersion: 2,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    dealId: input.dealId,
    revision,
    value: input.value,
    currency: "EUR",
    status,
    // A sent proposal keeps a send date — "waiting since" depends on it — but
    // on any other status an emptied field means the user cleared it, the way
    // validUntil below already behaves.
    sentAt: input.sentAt || (status === "sent" ? (existing?.sentAt ?? now) : null),
    decidedAt: decided ? (existing?.decidedAt ?? now) : null,
    validUntil: input.validUntil || null,
    notes: input.notes || null,
    createdById: existing?.createdById ?? user.id,
    createdByName: existing?.createdByName ?? user.name,
  };

  await getCrmOverlayStore().saveProposal(proposal);
  await logAudit({
    actorId: user.id,
    actorName: user.name,
    action: existing ? "proposal.update" : "proposal.create",
    entity: "proposal",
    entityId: proposal.id,
    summary: `${existing ? "Updated" : "Added"} proposal for ${deal.name} — €${proposal.value.toLocaleString()} (${status})`,
  });

  revalidatePath(`/dashboard/pipeline/${input.dealId}`);
  revalidatePath("/dashboard/companies");
  return { ok: true };
}

export async function deleteProposal(_prev: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const { user } = await requirePermission("proposal:manage");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Missing proposal." };

  const graph = await getCrmGraph();
  const proposal = graph.proposals.find((p) => p.id === id);
  if (!proposal) return { ok: true };

  await getCrmOverlayStore().removeProposal(id);
  await logAudit({
    actorId: user.id,
    actorName: user.name,
    action: "proposal.delete",
    entity: "proposal",
    entityId: id,
    summary: `Deleted a €${proposal.value.toLocaleString()} proposal`,
  });

  revalidatePath(`/dashboard/pipeline/${proposal.dealId}`);
  return { ok: true };
}
