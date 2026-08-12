import "server-only";
import { z } from "zod";
import { getDataQuality } from "@/lib/data";
import { getVisibleBrands, visibleLead, writableLead } from "@/lib/leads/visible";
import { getBrandStore } from "@/lib/store/brands";
import { getAuditStore } from "@/lib/store/audit";
import { getOutreachStore } from "@/lib/store/outreach";
import { getCrmOverlayStore } from "@/lib/store/crm";
import { getCrmGraph } from "@/lib/crm/graph";
import { recordProposal } from "@/lib/crm/proposals";
import { duplicateCandidates, currentProposals } from "@/lib/crm/logic";
import { completeFollowUp, snoozeFollowUp } from "@/lib/leads/followups";
import { budgetVariance } from "@/lib/pipeline/budget";
import { effectiveTempoMonths } from "@/lib/scoring";
import { STRATEGIC_REASONS } from "@/lib/priority";
import { outcomeConflicts, openLeads, outcomeOf } from "@/lib/lifecycle";
import { logAudit } from "@/lib/store/audit";
import { todayYmd } from "@/lib/workflow";
import type { CopilotTool } from "./tools";
import type { ProposalStatus } from "@/lib/crm/types";

/**
 * The second half of the tool surface: everything the screens could do that
 * the chat could not.
 *
 * Every tool here declares the permission it needs — `runTool` enforces it —
 * and anything touching a specific lead resolves it through visibleLead or
 * writableLead so record scope applies to conversation exactly as it does to
 * the UI.
 */

const PROPOSAL_STATUSES = ["draft", "sent", "accepted", "rejected", "expired", "withdrawn"] as const;

// ---------------------------------------------------------------------------
// Writes — the things a person would otherwise have to go and click
// ---------------------------------------------------------------------------

const setNextMove: CopilotTool = {
  name: "set_next_move",
  permission: "lead:update",
  write: true,
  description:
    "Record who owes the next move on a lead and when it is due. waitingOn='us' means we owe them a reply (a proposal, an answer); 'them' means they owe us (feedback, a decision) and the date is when we should chase; 'nobody' clears it. Use for 'mark Poste as waiting on them, chase in two weeks' or 'I owe Luxottica a quote by Friday'.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Lead id" },
      waitingOn: { type: "string", enum: ["us", "them", "nobody"] },
      nextStep: { type: "string", description: "What the move is, in plain words" },
      followUpDate: { type: "string", description: "Due date as YYYY-MM-DD, or 'none' to clear it" },
    },
    required: ["id"],
  },
  async execute(args, ctx) {
    const a = z
      .object({
        id: z.string().min(1),
        waitingOn: z.enum(["us", "them", "nobody"]).optional(),
        nextStep: z.string().max(200).optional(),
        followUpDate: z.string().optional(),
      })
      .parse(args);

    const brand = await writableLead(a.id, "lead:update");
    if (!brand) return { ok: false, error: "Lead not found." };

    const next = { ...brand };
    if (a.waitingOn) next.waitingOn = a.waitingOn === "nobody" ? null : a.waitingOn;
    if (a.nextStep !== undefined) next.nextStep = a.nextStep || null;
    if (a.followUpDate !== undefined) {
      if (a.followUpDate === "none") next.followUpDate = null;
      else if (/^\d{4}-\d{2}-\d{2}$/.test(a.followUpDate)) next.followUpDate = a.followUpDate;
      else return { ok: false, error: "followUpDate must be YYYY-MM-DD or 'none'." };
    }

    await getBrandStore().save(next);
    await logAudit({
      actorId: ctx.user.id,
      actorName: `${ctx.user.name} (via copilot)`,
      action: "lead.next_move",
      entity: "brand",
      entityId: brand.id,
      summary: `Next move on ${brand.name}: ${next.waitingOn ?? "nobody"}${next.followUpDate ? ` by ${next.followUpDate}` : ""}${next.nextStep ? ` — ${next.nextStep}` : ""}`,
    });

    return {
      ok: true,
      id: brand.id,
      name: brand.name,
      waitingOn: next.waitingOn ?? null,
      nextStep: next.nextStep ?? null,
      followUpDate: next.followUpDate,
    };
  },
};

const completeFollowUpTool: CopilotTool = {
  name: "complete_follow_up",
  permission: "reminder:complete",
  write: true,
  description:
    "Mark a lead's follow-up as done: clears the date and stamps today as the last contact. Use for 'I've called Moncler' or 'done with the Allianz follow-up'.",
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "Lead id" } },
    required: ["id"],
  },
  async execute(args, ctx) {
    const { id } = z.object({ id: z.string().min(1) }).parse(args);
    const brand = await writableLead(id, "reminder:complete");
    if (!brand) return { ok: false, error: "Lead not found." };

    await getBrandStore().save(completeFollowUp(brand));
    await logAudit({
      actorId: ctx.user.id,
      actorName: `${ctx.user.name} (via copilot)`,
      action: "reminder.done",
      entity: "brand",
      entityId: brand.id,
      summary: `Completed follow-up for ${brand.name}`,
    });
    return { ok: true, id: brand.id, name: brand.name, lastContact: todayYmd() };
  },
};

const snoozeFollowUpTool: CopilotTool = {
  name: "snooze_follow_up",
  permission: "reminder:update",
  write: true,
  description: "Push a lead's follow-up out by N days from today. Use for 'remind me about Reply in a week'.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Lead id" },
      days: { type: "integer", minimum: 1, maximum: 365 },
    },
    required: ["id", "days"],
  },
  async execute(args, ctx) {
    const { id, days } = z.object({ id: z.string().min(1), days: z.number().int().min(1).max(365) }).parse(args);
    const brand = await writableLead(id, "reminder:update");
    if (!brand) return { ok: false, error: "Lead not found." };

    const next = snoozeFollowUp(brand, days);
    await getBrandStore().save(next);
    await logAudit({
      actorId: ctx.user.id,
      actorName: `${ctx.user.name} (via copilot)`,
      action: "reminder.snooze",
      entity: "brand",
      entityId: brand.id,
      summary: `Snoozed ${brand.name} follow-up to ${next.followUpDate}`,
    });
    return { ok: true, id: brand.id, name: brand.name, followUpDate: next.followUpDate };
  },
};

const recordProposalTool: CopilotTool = {
  name: "record_proposal",
  permission: "proposal:manage",
  write: true,
  description:
    "Log a commercial proposal against a lead: its value, and whether it is a draft, has been sent, or has been accepted/rejected/expired/withdrawn. Each call adds a revision, so a re-quote is recorded rather than overwriting the first number. Accepting one also confirms the lead's budget and keeps the original estimate for comparison. Use for 'we sent Alleanza 52k' or 'Fastweb accepted at 40k'.",
  parameters: {
    type: "object",
    properties: {
      leadId: { type: "string", description: "Lead (deal) id the proposal belongs to" },
      valueEur: { type: "number", minimum: 0 },
      status: { type: "string", enum: [...PROPOSAL_STATUSES] },
      sentAt: { type: "string", description: "YYYY-MM-DD" },
      validUntil: { type: "string", description: "YYYY-MM-DD" },
      notes: { type: "string" },
    },
    required: ["leadId", "valueEur", "status"],
  },
  async execute(args, ctx) {
    const a = z
      .object({
        leadId: z.string().min(1),
        valueEur: z.number().min(0),
        status: z.enum(PROPOSAL_STATUSES),
        sentAt: z.string().optional(),
        validUntil: z.string().optional(),
        notes: z.string().max(500).optional(),
      })
      .parse(args);

    // A proposal belongs to a deal, so the deal's owner decides who may write it.
    const brand = await writableLead(a.leadId, "proposal:manage");
    if (!brand) return { ok: false, error: "Lead not found." };

    const result = await recordProposal(
      {
        dealId: a.leadId,
        value: a.valueEur,
        status: a.status as ProposalStatus,
        sentAt: a.sentAt,
        validUntil: a.validUntil,
        notes: a.notes,
      },
      ctx.user,
    );
    if ("error" in result) return { ok: false, error: result.error };

    await logAudit({
      actorId: ctx.user.id,
      actorName: `${ctx.user.name} (via copilot)`,
      action: "proposal.create",
      entity: "proposal",
      entityId: result.proposal.id,
      summary: `Added proposal for ${brand.name} — €${a.valueEur.toLocaleString()} (${a.status})`,
    });

    return {
      ok: true,
      proposalId: result.proposal.id,
      leadId: a.leadId,
      name: brand.name,
      revision: result.proposal.revision,
      valueEur: result.proposal.value,
      status: result.proposal.status,
      confirmedBudget: result.confirmedBudget,
    };
  },
};

const setStrategicValue: CopilotTool = {
  name: "set_strategic_value",
  permission: "lead:update",
  write: true,
  description:
    "Record what a deal is worth beyond its invoice, 0–3, with the reason chosen from a fixed list. This is what lets a low-budget or free project stay visible in the ranking — it is capped at a quarter of the opportunity axis, so it can never outrank paid work on its own. Use for 'Montecarlo was for visibility and it produced the Alibaba lead'.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Lead id" },
      value: { type: "integer", minimum: 0, maximum: 3, description: "0 none · 1 some · 2 significant · 3 flagship" },
      reason: { type: "string", enum: [...STRATEGIC_REASONS] },
    },
    required: ["id", "value"],
  },
  async execute(args, ctx) {
    const a = z
      .object({
        id: z.string().min(1),
        value: z.number().int().min(0).max(3),
        reason: z.enum(STRATEGIC_REASONS).optional(),
      })
      .parse(args);

    const brand = await writableLead(a.id, "lead:update");
    if (!brand) return { ok: false, error: "Lead not found." };

    await getBrandStore().save({ ...brand, strategicValue: a.value, strategicReason: a.reason ?? brand.strategicReason ?? null });
    await logAudit({
      actorId: ctx.user.id,
      actorName: `${ctx.user.name} (via copilot)`,
      action: "lead.strategic_value",
      entity: "brand",
      entityId: brand.id,
      summary: `Strategic value for ${brand.name} set to ${a.value}${a.reason ? ` (${a.reason})` : ""}`,
    });
    return { ok: true, id: brand.id, name: brand.name, strategicValue: a.value, strategicReason: a.reason ?? null };
  },
};

const linkCompany: CopilotTool = {
  name: "link_deal_to_company",
  permission: "lead:update",
  write: true,
  description:
    "Attach a lead to an existing company, so repeat business with that client adds up. This is the only way two leads end up under one company — name similarity is never enough, because 'Allianz Bank' and 'Allianz CH' may be different customers. Use after confirming with the user which company is meant.",
  parameters: {
    type: "object",
    properties: {
      leadId: { type: "string" },
      companyId: { type: "string", description: "Target company id from search_companies" },
    },
    required: ["leadId", "companyId"],
  },
  async execute(args, ctx) {
    const a = z.object({ leadId: z.string().min(1), companyId: z.string().min(1) }).parse(args);
    const brand = await writableLead(a.leadId, "lead:update");
    if (!brand) return { ok: false, error: "Lead not found." };

    const graph = await getCrmGraph();
    const deal = graph.deals.find((d) => d.id === a.leadId);
    const target = graph.companies.find((c) => c.id === a.companyId);
    if (!deal) return { ok: false, error: "Lead not found." };
    if (!target) return { ok: false, error: "That company does not exist." };
    if (deal.companyId === a.companyId) return { ok: true, note: "Already linked.", leadId: a.leadId, companyId: a.companyId };

    await getCrmOverlayStore().linkDeal({
      dealId: a.leadId,
      companyId: a.companyId,
      companyName: target.name,
      linkedById: ctx.user.id,
      linkedByName: ctx.user.name,
      linkedAt: new Date().toISOString(),
    });
    await logAudit({
      actorId: ctx.user.id,
      actorName: `${ctx.user.name} (via copilot)`,
      action: "company.link",
      entity: "deal",
      entityId: a.leadId,
      summary: `Linked ${deal.name} to ${target.name}`,
    });
    return { ok: true, leadId: a.leadId, companyId: a.companyId, companyName: target.name };
  },
};

// ---------------------------------------------------------------------------
// Reads — questions the platform could answer but the chat could not
// ---------------------------------------------------------------------------

const dataQuality: CopilotTool = {
  name: "data_quality",
  permission: "quality:read",
  description:
    "What is broken or missing in the pipeline data: unscored leads, missing fields, stale contacts, and rows where the imported outcome contradicts the current stage (usually one record carrying two engagements, not a typo). Use for 'what needs cleaning up?' or before trusting a total.",
  parameters: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } } },
  async execute(args) {
    const { limit } = z.object({ limit: z.number().int().min(1).max(50).optional() }).parse(args);
    const { issues, count } = getDataQuality();
    const brands = await getVisibleBrands();
    const conflicts = outcomeConflicts(brands);
    const open = openLeads(brands);

    return {
      issueCount: count,
      issues: issues.slice(0, limit ?? 15),
      outcomeConflicts: conflicts.map((c) => ({ id: c.id, name: c.name, stage: c.status, importedOutcome: c.process })),
      openLeadsWithoutOwner: open.filter((b) => !b.owner).length,
      openLeadsWithoutFollowUp: open.filter((b) => !b.followUpDate).length,
      unscored: brands.filter((b) => !b.scored).length,
    };
  },
};

const leadHistory: CopilotTool = {
  name: "lead_history",
  permission: "audit:read",
  description:
    "The audit trail for one lead — who changed what and when, including changes made through this chat. Use for 'who moved Fastweb to Advanced?' or 'what happened to this deal last month?'.",
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "Lead id" }, limit: { type: "integer", minimum: 1, maximum: 50 } },
    required: ["id"],
  },
  async execute(args) {
    const { id, limit } = z
      .object({ id: z.string().min(1), limit: z.number().int().min(1).max(50).optional() })
      .parse(args);
    // Scoped: the history of a lead you cannot see is itself a leak.
    const brand = await visibleLead(id);
    if (!brand) return { found: false, id };

    const entries = await getAuditStore().list(500);
    const mine = entries.filter((e) => e.entityId === id || (e.entity === "brand" && e.entityId === id));
    return {
      found: true,
      id,
      name: brand.name,
      entryCount: mine.length,
      history: mine.slice(0, limit ?? 20).map((e) => ({ at: e.at, actor: e.actorName, action: e.action, summary: e.summary })),
    };
  },
};

const tempoReport: CopilotTool = {
  name: "tempo_report",
  permission: "lead:read",
  description:
    "How long deals take: the estimate made when each lead opened against the time it actually took once closed. Returns the average estimate, the average actual, and the deals that overran by the widest margin. Use for 'are we realistic about timings?' or 'which deals dragged?'.",
  parameters: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 25 } } },
  async execute(args) {
    const { limit } = z.object({ limit: z.number().int().min(1).max(25).optional() }).parse(args);
    const brands = await getVisibleBrands();

    const rows = brands
      .map((b) => ({ b, t: effectiveTempoMonths(b) }))
      .filter((r) => r.t.months != null);
    const actual = rows.filter((r) => r.t.basis === "actual");
    const estimated = rows.filter((r) => r.t.basis === "expected");
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : null);

    const overruns = actual
      .map((r) => {
        const expected = r.b.expectedMonths ?? r.b.scores?.tempoMonths ?? null;
        return expected == null ? null : { name: r.b.name, id: r.b.id, expectedMonths: expected, actualMonths: Number(r.t.months!.toFixed(1)), overrunMonths: Number((r.t.months! - expected).toFixed(1)) };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, c) => c.overrunMonths - a.overrunMonths);

    return {
      closedDealsMeasured: actual.length,
      openDealsEstimated: estimated.length,
      averageActualMonths: mean(actual.map((r) => r.t.months!))?.toFixed(1) ?? null,
      averageEstimatedMonths: mean(estimated.map((r) => r.t.months!))?.toFixed(1) ?? null,
      worstOverruns: overruns.slice(0, limit ?? 10),
      note: "Tempo means how long the deal takes, not how long since we last spoke — that is the freshness signal in pipeline_health.",
    };
  },
};

const budgetAccuracy: CopilotTool = {
  name: "budget_accuracy",
  permission: "proposal:read",
  description:
    "How the budget we guessed at the start compares with the offer actually accepted, per lead and on average. Answers 'do we systematically under-quote?'. Only leads with an accepted proposal have both numbers.",
  parameters: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 25 } } },
  async execute(args) {
    const { limit } = z.object({ limit: z.number().int().min(1).max(25).optional() }).parse(args);
    const brands = await getVisibleBrands();

    const rows = brands
      .map((b) => ({ b, v: budgetVariance(b) }))
      .filter((r): r is { b: (typeof brands)[number]; v: NonNullable<ReturnType<typeof budgetVariance>> } => r.v !== null)
      .map(({ b, v }) => ({
        id: b.id,
        name: b.name,
        estimatedEur: v.estimated,
        acceptedEur: v.actual,
        deltaEur: v.deltaEur,
        deltaPct: v.deltaPct == null ? null : Math.round(v.deltaPct),
      }))
      .sort((a, c) => Math.abs(c.deltaEur) - Math.abs(a.deltaEur));

    const deltas = rows.map((r) => r.deltaEur);
    return {
      dealsWithBothNumbers: rows.length,
      averageDeltaEur: deltas.length ? Math.round(deltas.reduce((a, c) => a + c, 0) / deltas.length) : null,
      underQuoted: rows.filter((r) => r.deltaEur > 0).length,
      overQuoted: rows.filter((r) => r.deltaEur < 0).length,
      leads: rows.slice(0, limit ?? 10),
      note: rows.length === 0 ? "No proposal has been accepted yet, so there is nothing to compare." : undefined,
    };
  },
};

const duplicateCompanies: CopilotTool = {
  name: "duplicate_companies",
  permission: "lead:read",
  description:
    "Companies that might be the same client, grouped for human review. Deliberately over-inclusive — 'Banca Aletti' and 'Banca Sella' will appear together — because the cost of missing a real duplicate is higher than the cost of dismissing one. Never merge without asking.",
  parameters: { type: "object", properties: {} },
  async execute() {
    const graph = await getCrmGraph();
    const groups = duplicateCandidates(graph.companies);
    return {
      groupCount: groups.length,
      groups: groups.map((g) => ({
        companies: g.map((c) => ({ id: c.id, name: c.name, openDeals: c.rollup.openDealCount, lifetimeValueEur: Math.round(c.rollup.lifetimeValue) })),
      })),
      note: "Suggestions only. Linking is an explicit human decision — use link_deal_to_company once the user confirms.",
    };
  },
};

const outreachStatus: CopilotTool = {
  name: "outreach_status",
  permission: "outreach:read",
  description:
    "The outbox: messages drafted, waiting for approval, sent, cancelled or failed. Use for 'what's waiting on me to approve?' or 'did we ever email Moncler?'.",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["draft", "pending_approval", "sent", "cancelled", "failed"] },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
  },
  async execute(args) {
    const a = z
      .object({
        status: z.enum(["draft", "pending_approval", "sent", "cancelled", "failed"]).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .parse(args);

    // Outreach carries a brandId, so it inherits the lead's visibility.
    const visible = new Set((await getVisibleBrands()).map((b) => b.id));
    const all = (await getOutreachStore().list()).filter((o) => visible.has(o.brandId));
    const rows = a.status ? all.filter((o) => o.status === a.status) : all;

    const byStatus: Record<string, number> = {};
    for (const o of all) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;

    return {
      total: all.length,
      byStatus,
      messages: rows.slice(0, a.limit ?? 15).map((o) => ({
        id: o.id,
        leadId: o.brandId,
        leadName: o.brandName,
        to: o.to,
        subject: o.subject,
        status: o.status,
        createdBy: o.createdByName,
        updatedAt: o.updatedAt,
      })),
    };
  },
};

const moneyAtRisk: CopilotTool = {
  name: "money_at_risk",
  permission: "proposal:read",
  description:
    "Euros sitting with clients that are going cold: proposals sent and unanswered, ranked by how long they have been waiting, with the lead's last contact. Use for 'what should I chase for money?' — proposal_pipeline gives the totals, this gives the queue.",
  parameters: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 25 } } },
  async execute(args) {
    const { limit } = z.object({ limit: z.number().int().min(1).max(25).optional() }).parse(args);
    const [graph, brands] = await Promise.all([getCrmGraph(), getVisibleBrands()]);
    const byId = new Map(brands.map((b) => [b.id, b]));

    const waiting = currentProposals(graph.proposals)
      .filter((p) => p.status === "sent")
      .map((p) => {
        const lead = byId.get(p.dealId);
        const open = lead ? outcomeOf(lead.status) === "open" : false;
        const since = p.sentAt ?? p.createdAt;
        const days = Math.max(0, Math.round((Date.now() - Date.parse(since)) / 86_400_000));
        return { lead, open, proposalId: p.id, leadId: p.dealId, name: lead?.name ?? p.dealId, valueEur: p.value, sentAt: since.slice(0, 10), daysWaiting: days, validUntil: p.validUntil, lastContact: lead?.lastContact ?? null };
      })
      .filter((r) => r.open)
      .sort((a, c) => c.daysWaiting - a.daysWaiting);

    return {
      count: waiting.length,
      totalEur: Math.round(waiting.reduce((s, r) => s + r.valueEur, 0)),
      oldestDaysWaiting: waiting[0]?.daysWaiting ?? null,
      proposals: waiting.slice(0, limit ?? 10).map(({ lead: _lead, open: _open, ...row }) => row),
    };
  },
};

export const EXTRA_TOOLS: CopilotTool[] = [
  setNextMove,
  completeFollowUpTool,
  snoozeFollowUpTool,
  recordProposalTool,
  setStrategicValue,
  linkCompany,
  dataQuality,
  leadHistory,
  tempoReport,
  budgetAccuracy,
  duplicateCompanies,
  outreachStatus,
  moneyAtRisk,
];
