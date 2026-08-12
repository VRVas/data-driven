import "server-only";
import { randomUUID } from "node:crypto";
import { getCrmGraph } from "./graph";
import { getCrmOverlayStore } from "@/lib/store/crm";
import { getBrandStore } from "@/lib/store/brands";
import { confirmBudget } from "@/lib/pipeline/budget";
import type { Deal, Proposal, ProposalStatus } from "./types";

/**
 * Recording a proposal, in one place.
 *
 * The screens and the copilot both do this, and the rules are not obvious:
 * revisions increment per deal, a sent proposal keeps its stamp, and accepting
 * one rewrites the lead's budget as Confirmed while preserving the original
 * estimate. Two implementations of that would drift, and the drift would show
 * up as money.
 */

export interface RecordProposalInput {
  /** Omit to add a new revision; pass an id to edit that proposal in place. */
  id?: string;
  dealId: string;
  value: number;
  status: ProposalStatus;
  sentAt?: string | null;
  validUntil?: string | null;
  notes?: string | null;
}

export interface RecordedProposal {
  proposal: Proposal;
  deal: Deal;
  /** Set when accepting the proposal also confirmed the lead's budget. */
  confirmedBudget: { estimated: number | null; accepted: number } | null;
}

const DECIDED: ProposalStatus[] = ["accepted", "rejected", "expired"];

export async function recordProposal(
  input: RecordProposalInput,
  actor: { id: string; name: string },
  now: Date = new Date(),
): Promise<RecordedProposal | { error: string }> {
  const graph = await getCrmGraph();
  const deal = graph.deals.find((d) => d.id === input.dealId);
  if (!deal) return { error: "That lead no longer exists." };

  const existing = input.id ? graph.proposals.find((p) => p.id === input.id) : null;
  if (input.id && !existing) return { error: "That proposal no longer exists." };

  const iso = now.toISOString();
  const decided = DECIDED.includes(input.status);
  const revision =
    existing?.revision ??
    graph.proposals.filter((p) => p.dealId === input.dealId).reduce((max, p) => Math.max(max, p.revision), 0) + 1;

  const proposal: Proposal = {
    id: existing?.id ?? `pr-${input.dealId}-${randomUUID().slice(0, 8)}`,
    type: "proposal",
    companyId: deal.companyId,
    schemaVersion: 2,
    createdAt: existing?.createdAt ?? iso,
    updatedAt: iso,
    dealId: input.dealId,
    revision,
    value: input.value,
    currency: "EUR",
    status: input.status,
    sentAt: input.sentAt || (input.status === "sent" ? (existing?.sentAt ?? iso) : null),
    decidedAt: decided ? (existing?.decidedAt ?? iso) : null,
    validUntil: input.validUntil || null,
    notes: input.notes || null,
    createdById: existing?.createdById ?? actor.id,
    createdByName: existing?.createdByName ?? actor.name,
  };

  await getCrmOverlayStore().saveProposal(proposal);

  let confirmedBudget: RecordedProposal["confirmedBudget"] = null;
  if (input.status === "accepted") {
    const lead = await getBrandStore().get(input.dealId);
    const updated = lead ? confirmBudget(lead, proposal.value) : null;
    if (lead && updated && updated !== lead) {
      await getBrandStore().save(updated);
      confirmedBudget = { estimated: updated.budgetAtOpen ?? null, accepted: proposal.value };
    }
  }

  return { proposal, deal, confirmedBudget };
}
