import "server-only";
import { randomUUID } from "node:crypto";
import { getCrmGraph } from "./graph";
import { getCrmOverlayStore } from "@/lib/store/crm";
import { getBrandStore } from "@/lib/store/brands";
import { writeBudget, writeProposalValue } from "@/lib/pipeline/budget";
import { proposalValue } from "./logic";
import type { Deal, Proposal, ProposalStatus } from "./types";

/**
 * Recording a proposal, in one place.
 *
 * The screens and the copilot both do this, and the rules are not obvious:
 * revisions increment per deal, a sent proposal keeps its stamp, and the lead's
 * own value is kept in step with what the paperwork says. Two implementations
 * of that would drift, and the drift would show up as money.
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

  // The lead carries the deal's value for everything that is not a money
  // total - the priority axes, the quadrant bubble, exports, the copilot's
  // per-lead figures. Leaving it behind meant one deal was worth its proposal
  // in the pipeline totals and its opening guess in the score.
  const others = graph.proposals.filter((p) => p.dealId === input.dealId && p.id !== proposal.id);
  const confirmedBudget = await syncLeadValue(input.dealId, [...others, proposal]);

  return { proposal, deal, confirmedBudget };
}

/**
 * Bring the lead's own value into line with what its paperwork now says.
 *
 * Returns the estimate-versus-accepted pair when an acceptance is what moved
 * it, so the caller can record that in the audit trail.
 */
export async function syncLeadValue(
  dealId: string,
  proposals: Proposal[],
): Promise<RecordedProposal["confirmedBudget"]> {
  const store = getBrandStore();
  const lead = await store.get(dealId);
  if (!lead) return null;

  const paper = proposalValue(dealId, proposals);
  if (!paper) {
    // Nothing asserts a value any more. The figure is the last thing anyone
    // knew, but calling it Confirmed with no accepted offer behind it would
    // keep weighting it as fact.
    if (lead.scores?.assumption !== "Confirmed") return null;
    await store.save(writeBudget(lead, lead.scores.budget, "Estimated"));
    return null;
  }

  const updated = writeProposalValue(lead, paper.value, paper.basis === "accepted" ? "Confirmed" : "Estimated");
  if (updated === lead) return null;

  await store.save(updated);
  return paper.basis === "accepted"
    ? { estimated: updated.budgetAtOpen ?? null, accepted: paper.value }
    : null;
}
