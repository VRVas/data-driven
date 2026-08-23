import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDataQuality } from "@/lib/data";
import { getVisibleBrands, visibleLead, writableLead } from "@/lib/leads/visible";
import { getBrandStore } from "@/lib/store/brands";
import { getAuditStore } from "@/lib/store/audit";
import { getOutreachStore } from "@/lib/store/outreach";
import { getCrmOverlayStore } from "@/lib/store/crm";
import { getCrmGraph } from "@/lib/crm/graph";
import { recordProposal, syncLeadValue } from "@/lib/crm/proposals";
import { mergeCompanyInto } from "@/lib/crm/merge";
import { blankLead, freeLeadId } from "@/lib/leads/create";
import { getReminderStore, type Reminder } from "@/lib/store/reminders";
import { claim, contextFor, deliver } from "@/lib/reminders/dispatch";
import { composeReminderCancellation } from "@/lib/reminders/compose";
import { getEmailProvider } from "@/lib/mail/provider";
import { modelSpec, workedExample } from "./model-spec";
import { duplicateCandidates, currentProposals } from "@/lib/crm/logic";
import { completeFollowUp, snoozeFollowUp } from "@/lib/leads/followups";
import { sendExistingOutreach } from "@/lib/outreach/send";
import { requirePermission } from "@/lib/auth/authorize";
import { can } from "@/lib/auth/authorize";
import { budgetVariance, writeBudget } from "@/lib/pipeline/budget";
import { writeRubric } from "@/lib/pipeline/rubric";
import { BRAND_STATUSES, PRIORITIES, INDUSTRIES } from "@/lib/vocab";
import { withHealth } from "@/lib/pipeline/health";
import { effectiveTempoMonths } from "@/lib/scoring";
import { STRATEGIC_REASONS, priorityOf } from "@/lib/priority";
import { getAuthzContext } from "@/lib/auth/resolve";
import { scopeFor } from "@/lib/auth/effective";
import { PERMISSIONS, type PermissionDef, type PermissionKey } from "@/lib/auth/catalogue";
import { getProfileStore } from "@/lib/store/profiles";
import { outcomeConflicts, openLeads, outcomeOf } from "@/lib/lifecycle";
import { logAudit } from "@/lib/store/audit";
import { todayYmd } from "@/lib/workflow";
import type { CopilotTool } from "./tools";
import type { Brand } from "@/lib/types";
import type { ProposalStatus } from "@/lib/crm/types";

/** Zod enums need a non-empty tuple; the vocab lists are readonly arrays. */
const asEnumTuple = <T extends string>(v: readonly T[]) => v as unknown as [T, ...T[]];

/**
 * The second half of the tool surface: everything the screens could do that
 * the chat could not.
 *
 * Every tool here declares the permission it needs - `runTool` enforces it -
 * and anything touching a specific lead resolves it through visibleLead or
 * writableLead so record scope applies to conversation exactly as it does to
 * the UI.
 */

const PROPOSAL_STATUSES = ["draft", "sent", "accepted", "rejected", "expired", "withdrawn"] as const;

// ---------------------------------------------------------------------------
// Writes - the things a person would otherwise have to go and click
// ---------------------------------------------------------------------------

const createLead: CopilotTool = {
  name: "create_lead",
  permission: "lead:create",
  write: true,
  description:
    "Add a new lead. Only the name is required, but give it a commercial value if one is known - a lead with no value cannot be ranked at all, because zero opportunity is fatal in the priority formula. Pass companyId to start it under an existing client instead of creating a separate one, which is what you want for 'we worked with them last year and are talking again'. Use for 'add Zara, fashion, Marco owns it, about 40k'.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Brand or client name" },
      status: { type: "string", enum: [...BRAND_STATUSES] },
      priority: { type: "string", enum: [...PRIORITIES] },
      industry: { type: "string", enum: [...INDUSTRIES] },
      owner: { type: "string", description: "Who owns it, as a person's name" },
      poc: { type: "string", description: "Point of contact" },
      email: { type: "string" },
      valueEur: { type: "number", minimum: 0, description: "Expected value in euros" },
      companyId: { type: "string", description: "Attach to an existing company rather than creating a new one" },
      nextStep: { type: "string" },
      notes: { type: "string" },
    },
    required: ["name"],
  },
  async execute(args, ctx) {
    const a = z
      .object({
        name: z.string().trim().min(1).max(120),
        status: z.enum(asEnumTuple(BRAND_STATUSES)).optional(),
        priority: z.enum(asEnumTuple(PRIORITIES)).optional(),
        industry: z.enum(asEnumTuple(INDUSTRIES)).optional(),
        owner: z.string().trim().max(120).optional(),
        poc: z.string().trim().max(120).optional(),
        email: z.string().trim().email().optional(),
        valueEur: z.number().min(0).max(1_000_000_000).optional(),
        companyId: z.string().min(1).optional(),
        nextStep: z.string().trim().max(200).optional(),
        notes: z.string().trim().max(4000).optional(),
      })
      .parse(args);

    const store = getBrandStore();
    let lead = blankLead(await freeLeadId(a.name), a.name);
    lead.status = (a.status as Brand["status"]) ?? null;
    lead.priority = (a.priority as Brand["priority"]) ?? null;
    lead.industry = (a.industry as Brand["industry"]) ?? null;
    lead.industryRaw = a.industry ?? null;
    lead.owner = a.owner ?? null;
    lead.poc = a.poc ?? null;
    lead.email = a.email ?? null;
    lead.nextStep = a.nextStep ?? null;
    lead.notes = a.notes ?? null;
    if (a.valueEur != null) lead = writeBudget(lead, a.valueEur, "Estimated");

    await store.save(lead);

    // Same rule the company page uses: without the link the new deal would
    // project a company of its own and the client's history would not add up.
    let linkedTo: string | null = null;
    if (a.companyId) {
      const graph = await getCrmGraph();
      const target = graph.companies.find((c) => c.id === a.companyId);
      if (target) {
        await getCrmOverlayStore().linkDeal({
          dealId: lead.id,
          companyId: target.id,
          companyName: target.name,
          linkedById: ctx.user.id,
          linkedByName: ctx.user.name,
          linkedAt: new Date().toISOString(),
        });
        linkedTo = target.name;
      }
    }

    await logAudit({
      actorId: ctx.user.id,
      actorName: `${ctx.user.name} (via copilot)`,
      action: "brand.create",
      entity: "brand",
      entityId: lead.id,
      summary: `Created lead ${lead.name}${a.valueEur != null ? ` - €${a.valueEur.toLocaleString()}` : ""}`,
    });

    const p = priorityOf(lead);
    return {
      ok: true,
      id: lead.id,
      name: lead.name,
      status: lead.status,
      owner: lead.owner,
      valueEur: lead.scores?.budget ?? null,
      linkedToCompany: linkedTo,
      priority: p?.priority ?? null,
      grade: p?.grade ?? null,
      note:
        a.valueEur == null
          ? "No value was given, so this lead cannot be ranked yet - set_budget or record_proposal will fix that."
          : undefined,
    };
  },
};

const updateLead: CopilotTool = {
  name: "update_lead",
  permission: "lead:update",
  write: true,
  description:
    "Edit the fields of an existing lead - the same dialog the pipeline's edit button opens. Only the fields you pass are changed; pass an empty string to clear one. For the pipeline STAGE use advance_lead_stage instead, which enforces the legal transitions. For the commercial value prefer set_budget, and for who owes the next move prefer set_next_move.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Lead id" },
      name: { type: "string" },
      priority: { type: "string", enum: [...PRIORITIES] },
      industry: { type: "string", enum: [...INDUSTRIES] },
      poc: { type: "string" },
      email: { type: "string" },
      initialContact: { type: "string", description: "YYYY-MM-DD" },
      lastContact: { type: "string", description: "YYYY-MM-DD" },
      closingFailed: { type: "string", description: "YYYY-MM-DD" },
      expectedMonths: { type: "number", minimum: 0, maximum: 60, description: "How long the deal is expected to take" },
      notes: { type: "string" },
      customizationScore: { type: "number", minimum: 0, maximum: 5 },
      accessibilityScore: { type: "number", minimum: 0, maximum: 5 },
      receptivityScore: { type: "number", minimum: 0, maximum: 5 },
      alignmentScore: { type: "number", minimum: 0, maximum: 5 },
    },
    required: ["id"],
  },
  async execute(args, ctx) {
    const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD").or(z.literal(""));
    const rubric = z.number().min(0).max(5).nullable().optional();
    const a = z
      .object({
        id: z.string().min(1),
        name: z.string().trim().min(1).max(120).optional(),
        priority: z.enum(asEnumTuple(PRIORITIES)).or(z.literal("")).optional(),
        industry: z.enum(asEnumTuple(INDUSTRIES)).or(z.literal("")).optional(),
        poc: z.string().trim().max(120).optional(),
        email: z.string().trim().email().or(z.literal("")).optional(),
        initialContact: ymd.optional(),
        lastContact: ymd.optional(),
        closingFailed: ymd.optional(),
        expectedMonths: z.number().min(0).max(60).optional(),
        notes: z.string().trim().max(4000).optional(),
        customizationScore: rubric,
        accessibilityScore: rubric,
        receptivityScore: rubric,
        alignmentScore: rubric,
      })
      .parse(args);

    const brand = await writableLead(a.id, "lead:update");
    if (!brand) return { ok: false, error: "Lead not found." };

    const blank = <T>(v: string | undefined, cast: (s: string) => T): T | null | undefined =>
      v === undefined ? undefined : v === "" ? null : cast(v);

    let next: Brand = { ...brand };
    const changed: string[] = [];
    const set = <K extends keyof Brand>(key: K, value: Brand[K] | undefined) => {
      if (value === undefined || next[key] === value) return;
      next[key] = value;
      changed.push(String(key));
    };

    set("name", a.name);
    set("priority", blank(a.priority, (s) => s as Brand["priority"]));
    set("industry", blank(a.industry, (s) => s as Brand["industry"]));
    set("poc", blank(a.poc, (s) => s));
    set("email", blank(a.email, (s) => s));
    set("initialContact", blank(a.initialContact, (s) => s));
    set("lastContact", blank(a.lastContact, (s) => s));
    set("closingFailed", blank(a.closingFailed, (s) => s));
    set("notes", blank(a.notes, (s) => s));
    if (a.expectedMonths !== undefined) set("expectedMonths", a.expectedMonths);

    const rubricGiven =
      a.customizationScore !== undefined ||
      a.accessibilityScore !== undefined ||
      a.receptivityScore !== undefined ||
      a.alignmentScore !== undefined;
    if (rubricGiven) {
      const s = next.scores;
      next = writeRubric(next, {
        customizationScore: a.customizationScore ?? s?.customizationScore ?? null,
        accessibilityScore: a.accessibilityScore ?? s?.accessibilityScore ?? null,
        receptivityScore: a.receptivityScore ?? s?.receptivityScore ?? null,
        alignmentScore: a.alignmentScore ?? s?.alignmentScore ?? null,
      });
      changed.push("scores");
    }

    if (changed.length === 0) return { ok: true, id: brand.id, name: brand.name, note: "Nothing to change." };

    await getBrandStore().save(next);
    await logAudit({
      actorId: ctx.user.id,
      actorName: `${ctx.user.name} (via copilot)`,
      action: "brand.update",
      entity: "brand",
      entityId: brand.id,
      summary: `Updated ${brand.name}: ${changed.join(", ")}`,
    });

    const p = priorityOf(next);
    return { ok: true, id: brand.id, name: next.name, changed, priority: p?.priority ?? null, grade: p?.grade ?? null };
  },
};

const deleteLead: CopilotTool = {
  name: "delete_lead",
  permission: "lead:delete",
  write: true,
  description:
    "Permanently delete a lead and everything attached to it - its proposals, its company link, its outreach history. This cannot be undone. NEVER call it directly from a request: offer it as an actions block with a confirm message naming the lead, and let the user press the button. If they are asking how to remove a lead rather than asking you to, explain the Pipeline edit dialog instead.",
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "Lead id" } },
    required: ["id"],
  },
  async execute(args, ctx) {
    const { id } = z.object({ id: z.string().min(1) }).parse(args);
    const brand = await writableLead(id, "lead:delete");
    if (!brand) return { ok: false, error: "Lead not found." };

    await getBrandStore().remove(id);
    // Lead ids are name slugs, so recreating a deleted lead reuses its id.
    // Without this the new lead would inherit the dead one's paperwork.
    await getCrmOverlayStore().purgeDeal(id);
    await logAudit({
      actorId: ctx.user.id,
      actorName: `${ctx.user.name} (via copilot)`,
      action: "brand.delete",
      entity: "brand",
      entityId: id,
      summary: `Deleted lead ${brand.name}`,
    });
    return { ok: true, id, name: brand.name, deleted: true };
  },
};

const mergeCompaniesTool: CopilotTool = {
  name: "merge_companies",
  permission: "company:merge",
  write: true,
  description:
    "Fold one company into another: every deal on the source moves to the survivor, and the source stops existing because companies are projected from their deals. Use after duplicate_companies has suggested a pair AND the user has confirmed they are the same client - name similarity is never enough on its own. Offer it as a button naming both sides; undo is unlink_deal, one deal at a time.",
  parameters: {
    type: "object",
    properties: {
      sourceId: { type: "string", description: "The company that will disappear" },
      targetId: { type: "string", description: "The company that survives" },
    },
    required: ["sourceId", "targetId"],
  },
  async execute(args, ctx) {
    const a = z.object({ sourceId: z.string().min(1), targetId: z.string().min(1) }).parse(args);
    const auth = await requirePermission("company:merge");

    const result = await mergeCompanyInto(auth, a.sourceId, a.targetId);
    if ("error" in result) return { ok: false, error: result.error };

    await logAudit({
      actorId: ctx.user.id,
      actorName: `${ctx.user.name} (via copilot)`,
      action: "company.merge",
      entity: "company",
      entityId: a.targetId,
      summary: `Merged ${result.sourceName} into ${result.targetName} (${result.movedDealIds.length} ${result.movedDealIds.length === 1 ? "deal" : "deals"})`,
    });
    return { ok: true, ...result, movedDeals: result.movedDealIds.length };
  },
};

const unlinkDealTool: CopilotTool = {
  name: "unlink_deal",
  permission: "lead:update",
  write: true,
  description:
    "Detach a lead from the company it was linked to, so it stands on its own again. This is the undo for link_deal_to_company and for a merge that grouped the wrong records.",
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "Lead id" } },
    required: ["id"],
  },
  async execute(args, ctx) {
    const { id } = z.object({ id: z.string().min(1) }).parse(args);
    const brand = await writableLead(id, "lead:update");
    if (!brand) return { ok: false, error: "Lead not found." };

    await getCrmOverlayStore().unlinkDeal(id);
    await logAudit({
      actorId: ctx.user.id,
      actorName: `${ctx.user.name} (via copilot)`,
      action: "company.unlink",
      entity: "deal",
      entityId: id,
      summary: `Unlinked ${brand.name} from its company`,
    });
    return { ok: true, id, name: brand.name };
  },
};

const deleteProposalTool: CopilotTool = {
  name: "delete_proposal",
  permission: "proposal:manage",
  write: true,
  description:
    "Remove a proposal recorded in error. Get the id from get_company or proposal_pipeline. The lead's own value follows its remaining paperwork afterwards, so deleting the accepted offer drops the budget back to an estimate rather than leaving it marked Confirmed with nothing behind it. To record a change of price, add a revision with record_proposal instead - that keeps the history.",
  parameters: {
    type: "object",
    properties: { proposalId: { type: "string" } },
    required: ["proposalId"],
  },
  async execute(args, ctx) {
    const { proposalId } = z.object({ proposalId: z.string().min(1) }).parse(args);
    const graph = await getCrmGraph();
    const proposal = graph.proposals.find((p) => p.id === proposalId);
    if (!proposal) return { ok: false, error: "Proposal not found." };

    // The id came from a sentence, so the lead behind it is re-checked.
    const brand = await writableLead(proposal.dealId, "proposal:manage");
    if (!brand) return { ok: false, error: "Proposal not found." };

    await getCrmOverlayStore().removeProposal(proposalId);
    await syncLeadValue(
      proposal.dealId,
      graph.proposals.filter((p) => p.dealId === proposal.dealId && p.id !== proposalId),
    );
    await logAudit({
      actorId: ctx.user.id,
      actorName: `${ctx.user.name} (via copilot)`,
      action: "proposal.delete",
      entity: "proposal",
      entityId: proposalId,
      summary: `Deleted a €${proposal.value.toLocaleString()} proposal on ${brand.name}`,
    });
    return { ok: true, proposalId, leadId: proposal.dealId, name: brand.name, valueEur: proposal.value };
  },
};

const cancelOutreachTool: CopilotTool = {
  name: "cancel_outreach",
  permission: "outreach:cancel",
  write: true,
  description:
    "Cancel a drafted or pending outreach message so it can never be sent. Get the id from outreach_status. A message already sent cannot be cancelled - say so rather than implying it was recalled.",
  parameters: {
    type: "object",
    properties: { outreachId: { type: "string" } },
    required: ["outreachId"],
  },
  async execute(args, ctx) {
    const { outreachId } = z.object({ outreachId: z.string().min(1) }).parse(args);
    const auth = await requirePermission("outreach:cancel");

    const store = getOutreachStore();
    const record = await store.get(outreachId);
    if (!record) return { ok: false, error: "That message no longer exists." };
    if (record.status === "sent") return { ok: false, error: "Sent messages can't be cancelled." };
    // Same rule as the outbox: without approval you may only cancel your own.
    if (!(await can("outreach:approve")) && record.createdById !== auth.user.id) {
      return { ok: false, error: "You can only cancel your own drafts." };
    }

    await store.update({ ...record, status: "cancelled", updatedAt: new Date().toISOString() });
    await logAudit({
      actorId: ctx.user.id,
      actorName: `${ctx.user.name} (via copilot)`,
      action: "outreach.cancel",
      entity: "outreach",
      entityId: record.id,
      summary: `Cancelled outreach to ${record.brandName}`,
    });
    return { ok: true, outreachId, brandName: record.brandName, status: "cancelled" };
  },
};

const explainModel: CopilotTool = {
  name: "explain_model",
  permission: "scoring:read",
  description:
    "The complete specification of how every number on the platform is calculated: both priority axes with every term and weight, the quadrant thresholds, the grade bands, the stage probabilities, the confidence multipliers, what is deliberately EXCLUDED from the ranking, when it recalculates, how a deal's one commercial value is resolved, which statuses feed which money total, the health and tempo rules, and the superseded lead score. Pass a lead id to get a worked example with that lead's real numbers at every step. Use this for any 'how does X work', 'why does this rank there', 'what would change it' or 'why do these two figures differ' question - quote the actual weights rather than describing them loosely.",
  parameters: {
    type: "object",
    properties: {
      leadId: { type: "string", description: "Optional - adds a worked example using this lead's real values" },
    },
  },
  async execute(args) {
    const { leadId } = z.object({ leadId: z.string().min(1).optional() }).parse(args);
    const spec = modelSpec();
    if (!leadId) return { model: spec };

    const brand = await visibleLead(leadId);
    if (!brand) return { model: spec, example: null, note: "That lead was not found, so the spec is returned on its own." };
    return { model: spec, example: workedExample(brand) };
  },
};

const setReminder: CopilotTool = {
  name: "set_reminder",
  permission: "reminder:create",
  write: true,
  description:
    "Schedule a reminder for the person you are talking to, or send it to them immediately. It arrives as an in-app notification, an email, or both. Attach a lead id and the email carries that lead's whole CRM state - stage, owner, value and where the figure came from, who owes the next move, the latest proposal, the client's rollup - so it is useful without opening the app. Ask for holdMinutes and a calendar invitation is attached, blocking that much time rather than merely noting it. Use for 'remind me tomorrow at 9 to chase Alleanza', 'block 30 minutes on Friday to work on the Poste proposal', or 'email me everything on BMW China now'. A reminder is always for the caller: there is no reminding somebody else.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "What to do, in the user's words" },
      dueAt: {
        type: "string",
        description: "ISO 8601 timestamp, or the literal 'now' to deliver immediately",
      },
      topic: { type: "string", description: "The discussion or topic it is about" },
      notes: { type: "string" },
      leadId: { type: "string", description: "Lead to pull CRM context from" },
      email: { type: "boolean", description: "Send by email. Default true." },
      inApp: { type: "boolean", description: "Raise an in-app notification. Default true." },
      holdMinutes: {
        type: "integer",
        minimum: 5,
        maximum: 480,
        description: "Attach a calendar invitation blocking this many minutes",
      },
    },
    required: ["title", "dueAt"],
  },
  async execute(args, ctx) {
    const a = z
      .object({
        title: z.string().trim().min(1).max(160),
        dueAt: z.string().trim().min(1),
        topic: z.string().trim().max(400).optional(),
        notes: z.string().trim().max(4000).optional(),
        leadId: z.string().trim().min(1).optional(),
        email: z.boolean().optional(),
        inApp: z.boolean().optional(),
        holdMinutes: z.number().int().min(5).max(480).optional(),
      })
      .parse(args);

    const due = a.dueAt.toLowerCase() === "now" ? new Date() : new Date(a.dueAt);
    if (Number.isNaN(due.getTime())) {
      return { ok: false, error: "dueAt must be an ISO 8601 timestamp or 'now'." };
    }
    if (!ctx.user.email) return { ok: false, error: "Your account has no email address to send to." };

    let brandName: string | null = null;
    if (a.leadId) {
      const lead = await visibleLead(a.leadId);
      if (!lead) return { ok: false, error: "Lead not found." };
      brandName = lead.name;
    }

    const now = new Date().toISOString();
    const reminder: Reminder = {
      id: `rem-${randomUUID()}`,
      ownerId: ctx.user.id,
      ownerName: ctx.user.name,
      ownerEmail: ctx.user.email,
      title: a.title,
      topic: a.topic ?? null,
      notes: a.notes ?? null,
      brandId: a.leadId ?? null,
      brandName,
      dueAt: due.toISOString(),
      channels: { inApp: a.inApp ?? true, email: a.email ?? true },
      holdMinutes: a.holdMinutes ?? null,
      status: "scheduled",
      sequence: 0,
      sentAt: null,
      error: null,
      attempts: 0,
      createdById: ctx.user.id,
      createdByName: ctx.user.name,
      createdAt: now,
      updatedAt: now,
    };

    await getReminderStore().create(reminder);
    await logAudit({
      actorId: ctx.user.id,
      actorName: `${ctx.user.name} (via copilot)`,
      action: "reminder.create",
      entity: "reminder",
      entityId: reminder.id,
      summary: `Set a reminder "${reminder.title}" for ${reminder.dueAt.slice(0, 16).replace("T", " ")}`,
    });

    // Same delivery path as a scheduled one, so "now" cannot behave differently.
    let delivered = false;
    if (due.getTime() <= Date.now()) {
      const claimed = await claim(reminder.id);
      if (claimed) delivered = (await deliver(claimed)).ok;
    }

    return {
      ok: true,
      id: reminder.id,
      title: reminder.title,
      dueAt: reminder.dueAt,
      delivered,
      channels: reminder.channels,
      holdMinutes: reminder.holdMinutes,
      lead: brandName,
      note: reminder.holdMinutes
        ? `A calendar invitation for ${reminder.holdMinutes} minutes is attached, so the time is held rather than noted.`
        : undefined,
    };
  },
};

const listReminders: CopilotTool = {
  name: "list_my_reminders",
  permission: "reminder:read",
  description:
    "The caller's own scheduled and recently delivered reminders, with their status and channels. Use before setting a near-duplicate, and for 'what have I got set?'. This is NOT the follow-up list derived from lead follow-up dates - list_reminders is that.",
  parameters: {
    type: "object",
    properties: { includeDone: { type: "boolean", description: "Include cancelled and completed. Default false." } },
  },
  async execute(args, ctx) {
    const { includeDone } = z.object({ includeDone: z.boolean().optional() }).parse(args);
    const all = await getReminderStore().listForUser(ctx.user.id, 100);
    const rows = includeDone ? all : all.filter((r) => r.status !== "cancelled" && r.status !== "done");

    return {
      count: rows.length,
      reminders: rows.map((r) => ({
        id: r.id,
        title: r.title,
        topic: r.topic,
        dueAt: r.dueAt,
        status: r.status,
        channels: r.channels,
        holdMinutes: r.holdMinutes,
        leadId: r.brandId,
        lead: r.brandName,
        error: r.error,
      })),
    };
  },
};

const cancelReminderTool: CopilotTool = {
  name: "cancel_reminder",
  permission: "reminder:update",
  write: true,
  description:
    "Withdraw a reminder the caller set. Get the id from list_my_reminders. If it had blocked calendar time and the invitation already went out, a cancellation is emailed so the time is released rather than left held.",
  parameters: {
    type: "object",
    properties: { reminderId: { type: "string" } },
    required: ["reminderId"],
  },
  async execute(args, ctx) {
    const { reminderId } = z.object({ reminderId: z.string().min(1) }).parse(args);
    const store = getReminderStore();
    const reminder = await store.get(reminderId);
    if (!reminder) return { ok: false, error: "That reminder no longer exists." };
    // Ownership, not scope: a reminder is personal.
    if (reminder.ownerId !== ctx.user.id) return { ok: false, error: "That reminder is not yours." };
    if (reminder.status === "cancelled") return { ok: true, id: reminderId, note: "Already cancelled." };

    await store.update({ ...reminder, status: "cancelled", updatedAt: new Date().toISOString() });

    let released = false;
    if (reminder.holdMinutes && reminder.status === "sent" && reminder.channels.email) {
      const mail = composeReminderCancellation(await contextFor(reminder));
      const result = await getEmailProvider().send({
        to: reminder.ownerEmail,
        toName: reminder.ownerName,
        subject: mail.subject,
        body: mail.body,
        attachments: mail.attachments,
      });
      released = result.ok;
    }

    await logAudit({
      actorId: ctx.user.id,
      actorName: `${ctx.user.name} (via copilot)`,
      action: "reminder.cancel",
      entity: "reminder",
      entityId: reminderId,
      summary: `Cancelled reminder "${reminder.title}"`,
    });
    return { ok: true, id: reminderId, title: reminder.title, calendarTimeReleased: released };
  },
};

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
      summary: `Next move on ${brand.name}: ${next.waitingOn ?? "nobody"}${next.followUpDate ? ` by ${next.followUpDate}` : ""}${next.nextStep ? ` - ${next.nextStep}` : ""}`,
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
    "Log a commercial proposal against a lead: its value, and whether it is a draft, has been sent, or has been accepted/rejected/expired/withdrawn. Each call adds a revision, so a re-quote is recorded rather than overwriting the first number. The lead's own value follows the paperwork - a live ask becomes its estimate, an accepted one becomes its confirmed budget, and the original guess is kept for comparison. Use for 'we sent Alleanza 52k' or 'Fastweb accepted at 40k'.",
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
      summary: `Added proposal for ${brand.name} - €${a.valueEur.toLocaleString()} (${a.status})`,
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
    "Record what a deal is worth beyond its invoice, 0-3, with the reason chosen from a fixed list. This is what lets a low-budget or free project stay visible in the ranking - it is capped at a quarter of the opportunity axis, so it can never outrank paid work on its own. Use for 'Montecarlo was for visibility and it produced the Alibaba lead'.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Lead id" },
      value: { type: "integer", minimum: 0, maximum: 3, description: "0 none - 1 some - 2 significant - 3 flagship" },
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

const setBudget: CopilotTool = {
  name: "set_budget",
  permission: "lead:update",
  write: true,
  description:
    "Set what a lead is expected to be worth, in euros. This is the estimate the ranking uses until a proposal replaces it - a lead with no value cannot be ranked at all, because zero opportunity is fatal in the priority formula. Use for 'Fastweb is looking like about 60k'. Do NOT use this to record an offer that was actually sent or accepted: record_proposal does that, and it updates the figure itself.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Lead id" },
      valueEur: { type: "number", minimum: 0, description: "The expected value in euros" },
      confidence: {
        type: "string",
        enum: ["Estimated", "Confirmed"],
        description: "Confirmed only when the client has actually agreed the figure. Defaults to Estimated.",
      },
    },
    required: ["id", "valueEur"],
  },
  async execute(args, ctx) {
    const a = z
      .object({
        id: z.string().min(1),
        valueEur: z.number().min(0).max(1_000_000_000),
        confidence: z.enum(["Estimated", "Confirmed"]).optional(),
      })
      .parse(args);

    const brand = await writableLead(a.id, "lead:update");
    if (!brand) return { ok: false, error: "Lead not found." };

    const before = brand.scores?.budget ?? null;
    // The same writer the form uses, so a lead given a value in chat becomes
    // rankable exactly as one given a value on screen.
    const next = writeBudget(brand, a.valueEur, a.confidence ?? "Estimated");
    await getBrandStore().save(next);
    await logAudit({
      actorId: ctx.user.id,
      actorName: `${ctx.user.name} (via copilot)`,
      action: "lead.budget",
      entity: "brand",
      entityId: brand.id,
      summary: `Value for ${brand.name} set to €${a.valueEur.toLocaleString()} (${a.confidence ?? "Estimated"})${before == null ? "" : `, was €${before.toLocaleString()}`}`,
    });

    const p = priorityOf(next);
    return {
      ok: true,
      id: brand.id,
      name: brand.name,
      previousEur: before,
      valueEur: a.valueEur,
      confidence: a.confidence ?? "Estimated",
      priority: p?.priority ?? null,
      grade: p?.grade ?? null,
      note: "A proposal recorded later replaces this figure - an accepted one makes it Confirmed.",
    };
  },
};

const linkCompany: CopilotTool = {
  name: "link_deal_to_company",
  permission: "lead:update",
  write: true,
  description:
    "Attach a lead to an existing company, so repeat business with that client adds up. This is the only way two leads end up under one company - name similarity is never enough, because 'Allianz Bank' and 'Allianz CH' may be different customers. Use after confirming with the user which company is meant.",
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
// Reads - questions the platform could answer but the chat could not
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
    "The audit trail for one lead - who changed what and when, including changes made through this chat. Use for 'who moved Fastweb to Advanced?' or 'what happened to this deal last month?'.",
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
      note: "Tempo means how long the deal takes, not how long since we last spoke - that is the freshness signal in pipeline_health.",
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
    "Companies that might be the same client, grouped for human review. Deliberately over-inclusive - 'Banca Aletti' and 'Banca Sella' will appear together - because the cost of missing a real duplicate is higher than the cost of dismissing one. Never merge without asking.",
  parameters: { type: "object", properties: {} },
  async execute() {
    const graph = await getCrmGraph();
    const groups = duplicateCandidates(graph.companies);
    return {
      groupCount: groups.length,
      groups: groups.map((g) => ({
        companies: g.map((c) => ({ id: c.id, name: c.name, openDeals: c.rollup.openDealCount, lifetimeValueEur: Math.round(c.rollup.lifetimeValue) })),
      })),
      note: "Suggestions only. Linking is an explicit human decision - use link_deal_to_company once the user confirms.",
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
    "Euros sitting with clients that are going cold: proposals sent and unanswered, ranked by how long they have been waiting, with the lead's last contact. Use for 'what should I chase for money?' - proposal_pipeline gives the totals, this gives the queue.",
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

const assignLead: CopilotTool = {
  name: "assign_lead",
  permission: "lead:assign",
  write: true,
  description:
    "Hand a lead to someone else. Use for 'give Moncler to Sara' or 'take Poste off me'. Changing the owner changes who can see it under an 'own records' profile, so it is a permission change as much as an admin one.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Lead id" },
      owner: { type: "string", description: "The new owner's name, or 'unassigned' to clear it" },
    },
    required: ["id", "owner"],
  },
  async execute(args, ctx) {
    const a = z.object({ id: z.string().min(1), owner: z.string().min(1).max(80) }).parse(args);

    const brand = await writableLead(a.id, "lead:assign");
    if (!brand) return { ok: false, error: "Lead not found." };

    const previous = brand.owner ?? null;
    const owner = a.owner.trim().toLowerCase() === "unassigned" ? null : a.owner.trim();
    if (previous === owner) return { ok: true, id: brand.id, name: brand.name, owner, unchanged: true };

    await getBrandStore().save({ ...brand, owner });
    await logAudit({
      actorId: ctx.user.id,
      actorName: `${ctx.user.name} (via copilot)`,
      action: "lead.assign",
      entity: "brand",
      entityId: brand.id,
      summary: `${brand.name} reassigned from ${previous ?? "nobody"} to ${owner ?? "nobody"}`,
    });

    return { ok: true, id: brand.id, name: brand.name, previousOwner: previous, owner };
  },
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const myWorkQueue: CopilotTool = {
  name: "my_work_queue",
  permission: "lead:read",
  description:
    "The answer to 'what should I do today?'. One ranked list of everything that actually needs a human: follow-ups we have missed, clients we have not chased, deals nobody has triaged, deals gone quiet, and proposals sitting unanswered. Ordered by how much is at stake, not by date, so a big deal two days late outranks a small one two weeks late.",
  parameters: {
    type: "object",
    properties: {
      owner: { type: "string", description: "Limit to one person's leads; omit for everything you can see" },
      limit: { type: "integer", minimum: 1, maximum: 25 },
    },
  },
  async execute(args) {
    const a = z.object({ owner: z.string().optional(), limit: z.number().int().min(1).max(25).optional() }).parse(args);

    const [brands, graph] = await Promise.all([getVisibleBrands(), getCrmGraph()]);
    const mine = a.owner ? brands.filter((b) => (b.owner ?? "").toLowerCase() === a.owner!.toLowerCase()) : brands;
    const rows = withHealth(mine, graph.proposals).filter((r) => outcomeOf(r.brand.status) === "open");

    // One lead can be late AND stale. It appears once, under its worst reason,
    // because a queue that lists the same client twice gets ignored.
    const reasonOf = (h: (typeof rows)[number]["health"]) =>
      h.lateOnUs ? "late-on-us" : h.lateOnThem ? "late-on-them" : h.untriaged ? "untriaged" : h.stale ? "stale" : null;

    const items = rows
      .map((r) => {
        const reason = reasonOf(r.health);
        if (!reason) return null;
        const p = priorityOf(r.brand);
        return {
          id: r.brand.id,
          name: r.brand.name,
          owner: r.brand.owner ?? null,
          reason,
          waitingOn: r.health.waitingOn,
          daysLate: r.health.daysLate,
          daysSinceContact: r.health.daysSinceContact,
          dueDate: r.health.dueDate,
          nextStep: r.brand.nextStep ?? null,
          priorityScore: p?.priority ?? null,
          grade: p?.grade ?? null,
          valueEur: r.brand.scores?.budget ?? null,
          // What to actually do, so the model does not have to invent it.
          suggestedTool:
            reason === "untriaged" ? "set_next_move" : reason === "late-on-us" ? "draft_outreach" : "complete_follow_up",
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      // Stake first, lateness as the tie-break: priority already folds in money,
      // win odds and strategic value, which a due date knows nothing about.
      .sort((x, y) => (y.priorityScore ?? 0) - (x.priorityScore ?? 0) || y.daysLate - x.daysLate);

    const byReason: Record<string, number> = {};
    for (const i of items) byReason[i.reason] = (byReason[i.reason] ?? 0) + 1;

    return {
      total: items.length,
      byReason,
      openLeads: rows.length,
      items: items.slice(0, a.limit ?? 10),
      note: items.length === 0 ? "Nothing is overdue, untriaged or stale - the queue is genuinely empty." : undefined,
    };
  },
};

const whitespace: CopilotTool = {
  name: "whitespace",
  permission: "lead:read",
  description:
    "Clients we have already won who have no live deal - the cheapest pipeline there is, because the relationship is paid for. Ranked by what they have spent with us. Use for 'who should we go back to?' or 'where is the repeat business?'.",
  parameters: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 25 } } },
  async execute(args) {
    const { limit } = z.object({ limit: z.number().int().min(1).max(25).optional() }).parse(args);

    const [graph, brands] = await Promise.all([getCrmGraph(), getVisibleBrands()]);
    // Companies are only as visible as the deals underneath them.
    const visibleLeads = new Set(brands.map((b) => b.id));
    const visibleCompanies = new Set(graph.deals.filter((d) => visibleLeads.has(d.id)).map((d) => d.companyId));

    const dormant = graph.companies
      .filter((c) => visibleCompanies.has(c.id))
      .filter((c) => c.rollup.wonDealCount > 0 && c.rollup.openDealCount === 0)
      .map((c) => ({
        id: c.id,
        name: c.name,
        industry: c.industry ?? null,
        owner: c.owner ?? null,
        wonDeals: c.rollup.wonDealCount,
        lifetimeValueEur: Math.round(c.rollup.lifetimeValue),
        repeatValueEur: Math.round(c.rollup.repeatValue),
        lastContact: c.rollup.lastContact,
      }))
      .sort((a, b) => b.lifetimeValueEur - a.lifetimeValueEur);

    return {
      count: dormant.length,
      totalLifetimeValueEur: dormant.reduce((s, c) => s + c.lifetimeValueEur, 0),
      companies: dormant.slice(0, limit ?? 10),
      note: "A won client with no open deal is dormant, not lost - the next deal starts from a reference, not a cold call.",
    };
  },
};

const whatCanIDo: CopilotTool = {
  name: "what_can_i_do",
  // Gated on copilot:use rather than left open: anyone who can reach the chat
  // at all already holds it, so this refuses nobody who could have asked - and
  // the "every tool declares a permission" invariant survives intact.
  permission: "copilot:use",
  description:
    "What the person asking is allowed to do, and over which records. Use whenever someone asks 'can I…', 'why can't I…', 'what am I allowed to see' - and before telling them something is impossible, since it is usually permitted for someone and not for them.",
  parameters: { type: "object", properties: { about: { type: "string", description: "Optional filter, e.g. 'leads', 'proposals', 'export'" } } },
  async execute(args) {
    const { about } = z.object({ about: z.string().optional() }).parse(args);

    const authz = await getAuthzContext();
    if (!authz) return { ok: false, error: "No signed-in caller." };

    const profiles = await getProfileStore().list();
    const held = (PERMISSIONS as readonly PermissionDef[])
      .map((def) => ({ def, scope: scopeFor(authz.effective, def.key as PermissionKey) }))
      .filter((p) => p.scope !== "none");

    const needle = about?.trim().toLowerCase();
    const matches = needle
      ? held.filter((p) => `${p.def.key} ${p.def.label} ${p.def.category}`.toLowerCase().includes(needle))
      : held;

    const byCategory: Record<string, Array<{ key: string; label: string; scope: string; risk?: string }>> = {};
    for (const { def, scope } of matches) {
      (byCategory[def.category] ??= []).push({
        key: def.key,
        label: def.label,
        // A boolean permission has no "over which records", so saying "all" invites
        // the model to describe an on/off switch as unlimited reach.
        scope: def.scoped ? scope : "yes",
        risk: def.risk,
      });
    }

    return {
      user: authz.user.name,
      superuser: authz.superuser,
      profiles: authz.profileIds.map((id) => profiles.find((p) => p.id === id)?.name ?? id),
      grantedCount: held.length,
      totalCount: PERMISSIONS.length,
      byCategory,
      scopeMeaning: { own: "only records you own", team: "your team's records", all: "every record", yes: "held (not record-scoped)" },
      note: authz.superuser
        ? "Superuser: every permission, over every record."
        : "Anything not listed is denied. Permissions come from profiles an admin assigns - say who to ask rather than suggesting a workaround.",
    };
  },
};

const sendOutreachTool: CopilotTool = {
  name: "send_outreach",
  permission: "outreach:send",
  write: true,
  description:
    "Send an outreach email that has already been drafted, by its id from outreach_status. Deliberately cannot compose and send in one step: drafting, review and sending are separate on purpose, and this is the last of the three. The message leaves the building and cannot be recalled, so surface it as a button and let the person press it. Use for 'send the Moncler email' after they have seen the draft.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Outreach message id, from outreach_status" },
    },
    required: ["id"],
  },
  async execute(args, ctx) {
    const { id } = z.object({ id: z.string().min(1) }).parse(args);

    // runTool has already checked outreach:send; this re-reads the context so
    // the record scope travels with it, exactly as the outbox screen does.
    const auth = await requirePermission("outreach:send");
    const result = await sendExistingOutreach(auth, id);
    if (!result.ok) return { ok: false, error: result.error ?? "Send failed." };

    await logAudit({
      actorId: ctx.user.id,
      actorName: `${ctx.user.name} (via copilot)`,
      action: "outreach.send",
      entity: "outreach",
      entityId: id,
      summary: `Sent outreach to ${result.record?.brandName ?? id} from the copilot`,
    });

    return {
      ok: true,
      id,
      to: result.record?.to ?? null,
      subject: result.record?.subject ?? null,
      leadName: result.record?.brandName ?? null,
      provider: result.provider ?? null,
    };
  },
};

export const EXTRA_TOOLS: CopilotTool[] = [
  setNextMove,
  completeFollowUpTool,
  snoozeFollowUpTool,
  recordProposalTool,
  setStrategicValue,
  setBudget,
  setReminder,
  listReminders,
  cancelReminderTool,
  explainModel,
  createLead,
  updateLead,
  deleteLead,
  mergeCompaniesTool,
  unlinkDealTool,
  deleteProposalTool,
  cancelOutreachTool,
  linkCompany,
  assignLead,
  sendOutreachTool,
  dataQuality,
  leadHistory,
  tempoReport,
  budgetAccuracy,
  duplicateCompanies,
  outreachStatus,
  moneyAtRisk,
  myWorkQueue,
  whitespace,
  whatCanIDo,
];
