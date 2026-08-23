"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/authorize";
import { authorizeLead } from "@/lib/leads/visible";
import { getCrmOverlayStore } from "@/lib/store/crm";
import { getCrmGraph } from "@/lib/crm/graph";
import { recordProposal, syncLeadValue } from "@/lib/crm/proposals";
import { mergeCompanyInto } from "@/lib/crm/merge";
import { logAudit } from "@/lib/store/audit";
import type { ProposalStatus } from "@/lib/crm/types";

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
  const auth = await requirePermission("lead:update");
  const { user } = auth;

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
  await authorizeLead(auth, deal);
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
  // The company it just left also lost a deal, so its rollup is stale too.
  revalidatePath(`/dashboard/companies/${deal.companyId}`);
  revalidatePath(`/dashboard/pipeline/${dealId}`);
  return { ok: true };
}

/**
 * Fold one company into another: every deal it holds is re-pointed at the
 * survivor.
 *
 * Duplicate detection has always been deliberately over-inclusive and refused
 * to act on its own guesses, which left "merge them" as a manual job of
 * re-linking each deal by hand. This is that job, done once, and it is still a
 * human asserting the two are the same client.
 *
 * There is no separate merged-company record to write: companies are projected
 * from their deals, so a company with no deals left simply stops existing.
 */
export async function mergeCompanies(_prev: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const auth = await requirePermission("company:merge");
  const { user } = auth;

  const parsed = z
    .object({ sourceId: z.string().min(1), targetId: z.string().min(1) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Pick both companies." };
  const { sourceId, targetId } = parsed.data;

  const result = await mergeCompanyInto(auth, sourceId, targetId);
  if ("error" in result) return { error: result.error };

  await logAudit({
    actorId: user.id,
    actorName: user.name,
    action: "company.merge",
    entity: "company",
    entityId: targetId,
    summary: `Merged ${result.sourceName} into ${result.targetName} (${result.movedDealIds.length} ${result.movedDealIds.length === 1 ? "deal" : "deals"})`,
  });

  revalidatePath("/dashboard/companies");
  revalidatePath(`/dashboard/companies/${targetId}`);
  revalidatePath(`/dashboard/companies/${sourceId}`);
  for (const dealId of result.movedDealIds) revalidatePath(`/dashboard/pipeline/${dealId}`);
  return { ok: true };
}

/** Undo a link — the deal goes back to standing on its own. */
export async function unlinkDeal(_prev: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const auth = await requirePermission("lead:update");
  const { user } = auth;

  const dealId = String(formData.get("dealId") ?? "").trim();
  if (!dealId) return { error: "Missing lead." };

  // The id arrives from the form, so it has to be checked against what this
  // user can see rather than trusted.
  const graph = await getCrmGraph();
  const deal = graph.deals.find((d) => d.id === dealId);
  if (!deal) return { error: "That lead no longer exists." };
  await authorizeLead(auth, deal);

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
  revalidatePath(`/dashboard/companies/${deal.companyId}`);
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
  const auth = await requirePermission("proposal:manage");
  const { user } = auth;

  const parsed = proposalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the proposal." };
  const input = parsed.data;

  const graph = await getCrmGraph();
  const deal = graph.deals.find((d) => d.id === input.dealId);
  if (!deal) return { error: "That lead no longer exists." };
  // A proposal belongs to a deal, so the deal's owner decides who may write it.
  await authorizeLead(auth, deal);

  const wasEdit = !!input.id;
  const result = await recordProposal(
    {
      id: input.id,
      dealId: input.dealId,
      value: input.value,
      status: input.status as ProposalStatus,
      sentAt: input.sentAt,
      validUntil: input.validUntil,
      notes: input.notes,
    },
    user,
  );
  if ("error" in result) return { error: result.error };
  const { proposal, confirmedBudget } = result;

  await logAudit({
    actorId: user.id,
    actorName: user.name,
    action: wasEdit ? "proposal.update" : "proposal.create",
    entity: "proposal",
    entityId: proposal.id,
    summary: `${wasEdit ? "Updated" : "Added"} proposal for ${deal.name} — €${proposal.value.toLocaleString()} (${proposal.status})`,
  });

  if (confirmedBudget) {
    await logAudit({
      actorId: user.id,
      actorName: user.name,
      action: "brand.budget.confirmed",
      entity: "brand",
      entityId: input.dealId,
      summary: `Budget for ${deal.name} confirmed at €${confirmedBudget.accepted.toLocaleString()} by an accepted proposal (estimated €${(confirmedBudget.estimated ?? 0).toLocaleString()})`,
    });
    revalidatePath("/dashboard/scoring");
  }

  revalidatePath(`/dashboard/pipeline/${input.dealId}`);
  revalidatePath("/dashboard/pipeline");
  revalidatePath("/dashboard/companies");
  // Proposals show on both the lead and the company, and both money rollups
  // resolve through them.
  revalidatePath(`/dashboard/companies/${deal.companyId}`);
  return { ok: true };
}

export async function deleteProposal(_prev: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const auth = await requirePermission("proposal:manage");
  const { user } = auth;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Missing proposal." };

  const graph = await getCrmGraph();
  const proposal = graph.proposals.find((p) => p.id === id);
  if (!proposal) return { ok: true };
  const deal = graph.deals.find((d) => d.id === proposal.dealId);
  if (deal) await authorizeLead(auth, deal);

  await getCrmOverlayStore().removeProposal(id);
  // The lead mirrors its paperwork, so removing the paperwork has to move it —
  // otherwise a deleted acceptance leaves a Confirmed budget with nothing
  // behind it, still weighted as fact by the score.
  await syncLeadValue(
    proposal.dealId,
    graph.proposals.filter((p) => p.dealId === proposal.dealId && p.id !== id),
  );
  await logAudit({
    actorId: user.id,
    actorName: user.name,
    action: "proposal.delete",
    entity: "proposal",
    entityId: id,
    summary: `Deleted a €${proposal.value.toLocaleString()} proposal`,
  });

  revalidatePath(`/dashboard/pipeline/${proposal.dealId}`);
  revalidatePath("/dashboard/companies");
  revalidatePath(`/dashboard/companies/${proposal.companyId}`);
  return { ok: true };
}
