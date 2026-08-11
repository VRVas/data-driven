import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getBrand, getDataset } from "@/lib/data";
import { getVisibleBrands, canSeeBrand } from "@/lib/leads/visible";
import { getBrandStore } from "@/lib/store/brands";
import { getOutreachStore, type Outreach } from "@/lib/store/outreach";
import { answerFromDocuments } from "@/lib/copilot/documents";
import { groundedWebAnswer, isWebGroundingConfigured } from "@/lib/copilot/websearch";
import { getDocRegistryStore } from "@/lib/store/documents";
import { logAudit } from "@/lib/store/audit";
import { leadScore, quadrant, weightedValue, winProbability } from "@/lib/scoring";
import { openLeads, outcomeOf } from "@/lib/lifecycle";
import { opportunityScore, penetration, whitespace } from "@/lib/tam";
import { getCrmGraph, getCompanyDetail, getPipelineMoney } from "@/lib/crm/graph";
import { proposalsWithStatus, currentProposals } from "@/lib/crm/logic";
import type { Company } from "@/lib/crm/types";
import { remindersFrom } from "@/lib/reminders";
import { canTransition, statusSideEffects, todayYmd } from "@/lib/workflow";
import { renderTemplate, DEFAULT_TEMPLATE_ID, OUTREACH_TEMPLATES } from "@/lib/mail/templates";
import { BRAND_STATUSES, PRIORITIES, INDUSTRIES } from "@/lib/vocab";
import type { Brand, BrandStatus } from "@/lib/types";
import type { SessionUser } from "@/lib/auth/guards";

export interface ToolContext {
  user: SessionUser;
  /** Whether this caller may hold their own outreach draft rather than queue it. */
  canApprove: boolean;
}

export interface CopilotTool {
  name: string;
  description: string;
  /** JSON Schema (object) — used for the OpenAPI doc and Foundry function definitions. */
  parameters: Record<string, unknown>;
  /** Mutating tool → role-gated + audited. */
  write?: boolean;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

const asEnum = (v: readonly string[]) => v as unknown as [string, ...string[]];

/** Compact, model-friendly view of a lead (no UI tokens, only facts + computed values). */
function leadBrief(b: Brand) {
  const s = b.scores;
  return {
    id: b.id,
    name: b.name,
    status: b.status,
    outcome: outcomeOf(b.status),
    priority: b.priority,
    industry: b.industry,
    owner: b.owner,
    poc: b.poc,
    budgetEur: s?.budget ?? null,
    leadScore: leadScore(b),
    quadrant:
      s?.economicalEfficiency != null && s?.easeOfAccess != null
        ? quadrant(s.economicalEfficiency, s.easeOfAccess)
        : null,
    winProbability: winProbability(b.status),
    weightedValueEur: Math.round(weightedValue(b)),
    followUp: b.followUp,
    lastContact: b.lastContact,
  };
}

/** Compact view of a company — the relationship rollup, never the raw document. */
function companyBrief(c: Company) {
  const r = c.rollup;
  return {
    id: c.id,
    name: c.name,
    industry: c.industry,
    owner: c.owner,
    openDealCount: r.openDealCount,
    wonDealCount: r.wonDealCount,
    openPipelineEur: Math.round(r.openPipelineValue),
    lifetimeValueEur: Math.round(r.lifetimeValue),
    repeatValueEur: Math.round(r.repeatValue),
    winRate: r.winRate,
    lastContact: r.lastContact,
  };
}

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

const searchLeads: CopilotTool = {
  name: "search_leads",
  description:
    "Search and rank leads in the pipeline by any combination of status, priority, industry, owner or free text. Returns compact lead summaries with computed lead score, quadrant and weighted value. Ranks only live deals unless asked otherwise: pass outcome='won'/'lost'/'any' to include finished ones.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Free-text match on name, POC, notes or industry" },
      status: { type: "string", enum: [...BRAND_STATUSES] },
      outcome: {
        type: "string",
        enum: ["open", "won", "lost", "any"],
        description:
          "Unqualified rankings default to 'open' so only live deals are ranked; a free-text query or an explicit status searches everything. Set explicitly to override.",
      },
      priority: { type: "string", enum: [...PRIORITIES] },
      industry: { type: "string", enum: [...INDUSTRIES] },
      owner: { type: "string" },
      scoredOnly: { type: "boolean", description: "Only leads that have been scored" },
      minLeadScore: { type: "number", description: "Minimum composite lead score (0–5)" },
      sortBy: { type: "string", enum: ["leadScore", "weightedValue", "budget", "name"] },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
  },
  async execute(args) {
    const a = z
      .object({
        query: z.string().trim().optional(),
        status: z.enum(asEnum(BRAND_STATUSES)).optional(),
        outcome: z.enum(["open", "won", "lost", "any"]).optional(),
        priority: z.enum(asEnum(PRIORITIES)).optional(),
        industry: z.enum(asEnum(INDUSTRIES)).optional(),
        owner: z.string().trim().optional(),
        scoredOnly: z.boolean().optional(),
        minLeadScore: z.number().optional(),
        sortBy: z.enum(["leadScore", "weightedValue", "budget", "name"]).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .parse(args);

    let brands = await getVisibleBrands();
    // An unqualified ranking answers "where do we spend effort next", so finished
    // deals are out. A name lookup or an explicit status is a search — match anything.
    const outcomeFilter = a.outcome ?? (a.status || a.query ? "any" : "open");
    if (outcomeFilter !== "any") brands = brands.filter((b) => outcomeOf(b.status) === outcomeFilter);
    if (a.query) {
      const q = a.query.toLowerCase();
      brands = brands.filter((b) =>
        `${b.name} ${b.poc ?? ""} ${b.notes ?? ""} ${b.industry ?? ""}`.toLowerCase().includes(q),
      );
    }
    if (a.status) brands = brands.filter((b) => b.status === a.status);
    if (a.priority) brands = brands.filter((b) => b.priority === a.priority);
    if (a.industry) brands = brands.filter((b) => b.industry === a.industry);
    if (a.owner) brands = brands.filter((b) => b.owner === a.owner);
    if (a.scoredOnly) brands = brands.filter((b) => b.scored);
    if (a.minLeadScore != null) brands = brands.filter((b) => (leadScore(b) ?? -1) >= a.minLeadScore!);

    const briefs = brands.map(leadBrief);
    const sortBy = a.sortBy ?? "leadScore";
    briefs.sort((x, y) => {
      if (sortBy === "name") return x.name.localeCompare(y.name);
      const key = sortBy === "budget" ? "budgetEur" : sortBy === "weightedValue" ? "weightedValueEur" : "leadScore";
      return (Number(y[key] ?? -1) || -1) - (Number(x[key] ?? -1) || -1);
    });

    return { count: briefs.length, outcomeFilter, leads: briefs.slice(0, a.limit ?? 10) };
  },
};

const getLead: CopilotTool = {
  name: "get_lead",
  description: "Get the full detail of a single lead by id, including scores, timeline and outreach count.",
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "Lead id (slug), e.g. 'alibaba'" } },
    required: ["id"],
  },
  async execute(args) {
    const { id } = z.object({ id: z.string().min(1) }).parse(args);
    const b = await getBrand(id);
    if (!b) return { found: false, id };
    const outreach = await getOutreachStore().listForBrand(id);
    return {
      found: true,
      ...leadBrief(b),
      aliases: b.aliases,
      notes: b.notes,
      email: b.email,
      timeline: {
        initialContact: b.initialContact,
        lastContact: b.lastContact,
        followUp: b.followUp,
        closingFailed: b.closingFailed,
      },
      scores: b.scores ?? null,
      outreachCount: outreach.length,
    };
  },
};

const explainScore: CopilotTool = {
  name: "explain_score",
  description:
    "Explain how a lead's score is composed: the six sub-scores, the two aggregates (economical efficiency, ease of access), the blended lead score and its quadrant.",
  parameters: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
  async execute(args) {
    const { id } = z.object({ id: z.string().min(1) }).parse(args);
    const b = await getBrand(id);
    if (!b) return { found: false, id };
    if (!b.scores) return { found: true, id, scored: false, note: "This lead has not been scored yet." };
    const s = b.scores;
    return {
      found: true,
      id,
      name: b.name,
      scored: true,
      subScores: {
        tempo: s.tempoScore,
        budget: s.budgetScore,
        customization: s.customizationScore,
        accessibility: s.accessibilityScore,
        receptivity: s.receptivityScore,
        alignment: s.alignmentScore,
      },
      economicalEfficiency: s.economicalEfficiency,
      easeOfAccess: s.easeOfAccess,
      leadScore: leadScore(b),
      quadrant:
        s.economicalEfficiency != null && s.easeOfAccess != null
          ? quadrant(s.economicalEfficiency, s.easeOfAccess)
          : null,
      formula: "leadScore = economicalEfficiency*0.55 + easeOfAccess*0.45",
    };
  },
};

const pipelineSummary: CopilotTool = {
  name: "pipeline_summary",
  description:
    "Summarise the whole pipeline: totals, scored coverage, weighted (probability-adjusted) value, hot-lead and closed counts, and the count of leads at each stage. Prefer the open* figures when talking about live pipeline — the totals include finished deals.",
  parameters: { type: "object", properties: {} },
  async execute() {
    const brands = await getVisibleBrands();
    const live = openLeads(brands);
    const byStatus: Record<string, number> = {};
    for (const b of brands) if (b.status) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
    return {
      totalLeads: brands.length,
      openLeadCount: live.length,
      wonLeadCount: brands.filter((b) => outcomeOf(b.status) === "won").length,
      lostLeadCount: brands.filter((b) => outcomeOf(b.status) === "lost").length,
      scored: brands.filter((b) => b.scored).length,
      hotLeads: brands.filter((b) => b.priority === "Hot Lead").length,
      dealsClosed: brands.filter((b) => b.status === "Deal Closed").length,
      weightedValueEur: Math.round(brands.reduce((sum, b) => sum + weightedValue(b), 0)),
      openWeightedValueEur: Math.round(live.reduce((sum, b) => sum + weightedValue(b), 0)),
      byStatus,
    };
  },
};

const topOpportunities: CopilotTool = {
  name: "top_opportunities",
  description:
    "Rank industries by whitespace opportunity (value weight × untapped share). Highlights high-value, barely-approached segments.",
  parameters: {
    type: "object",
    properties: { limit: { type: "integer", minimum: 1, maximum: 10 } },
  },
  async execute(args) {
    const { limit } = z.object({ limit: z.number().int().min(1).max(10).optional() }).parse(args);
    const industries = getDataset().industries;
    const ranked = [...industries]
      .map((i) => ({
        industry: i.name,
        valuation: i.valuation,
        companiesEU: i.companiesEU,
        approached: i.opened,
        penetration: penetration(i.opened, i.companiesEU),
        whitespace: whitespace(i.opened, i.companiesEU),
        opportunityScore: opportunityScore(i),
      }))
      .sort((a, b) => b.opportunityScore - a.opportunityScore);
    return { industries: ranked.slice(0, limit ?? 5) };
  },
};

const listReminders: CopilotTool = {
  name: "list_reminders",
  description: "List follow-up reminders derived from lead follow-up dates, optionally filtered to a bucket.",
  parameters: {
    type: "object",
    properties: { bucket: { type: "string", enum: ["overdue", "today", "upcoming"] } },
  },
  async execute(args) {
    const { bucket } = z.object({ bucket: z.enum(["overdue", "today", "upcoming"]).optional() }).parse(args);
    let reminders = remindersFrom(await getVisibleBrands());
    if (bucket) reminders = reminders.filter((r) => r.bucket === bucket);
    return {
      count: reminders.length,
      reminders: reminders.map((r) => ({
        id: r.brand.id,
        name: r.brand.name,
        followUp: r.date,
        days: r.days,
        bucket: r.bucket,
        owner: r.brand.owner,
      })),
    };
  },
};

const searchCompanies: CopilotTool = {
  name: "search_companies",
  description:
    "Find or rank CLIENT COMPANIES — the organisation itself and everything we have done with it across every deal, past and present. Use this for the relationship: lifetime value, repeat business, which clients came back, who our biggest accounts are ('how much repeat business do we have with Fastweb?'). Use search_leads instead when the question is about individual engagements and their pipeline stage — one company can have several leads/deals over time. Returns compact company records with rolled-up open, lifetime and repeat value.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Free-text match on company name" },
      minRepeatValue: {
        type: "number",
        description: "Only companies whose repeat value (won beyond their first deal) is at least this many euros",
      },
      sortBy: { type: "string", enum: ["openPipeline", "lifetimeValue", "repeatValue", "name"] },
      limit: { type: "integer", minimum: 1, maximum: 25 },
    },
  },
  async execute(args) {
    const a = z
      .object({
        query: z.string().trim().optional(),
        minRepeatValue: z.number().optional(),
        sortBy: z.enum(["openPipeline", "lifetimeValue", "repeatValue", "name"]).optional(),
        limit: z.number().int().min(1).max(25).optional(),
      })
      .parse(args);

    const { companies } = await getCrmGraph();
    let rows = companies;
    if (a.query) {
      const q = a.query.toLowerCase();
      rows = rows.filter((c) => c.name.toLowerCase().includes(q));
    }
    const min = a.minRepeatValue;
    if (min != null) rows = rows.filter((c) => c.rollup.repeatValue >= min);

    const sortBy = a.sortBy ?? "openPipeline";
    const briefs = rows.map(companyBrief).sort((x, y) => {
      if (sortBy === "name") return x.name.localeCompare(y.name);
      const key =
        sortBy === "lifetimeValue"
          ? "lifetimeValueEur"
          : sortBy === "repeatValue"
            ? "repeatValueEur"
            : "openPipelineEur";
      return y[key] - x[key];
    });

    return { count: briefs.length, sortBy, companies: briefs.slice(0, a.limit ?? 10) };
  },
};

const getCompany: CopilotTool = {
  name: "get_company",
  description:
    "The full picture for one client company: its relationship rollup, every deal we have run with it (won, lost and live) and every proposal sent, with values and decisions. Use for 'show me everything for Generali' or any question spanning a client's whole history. Accepts a company id OR any lead/deal id belonging to it. Use get_lead instead for the detail of a single engagement.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Company id, or the id of any lead/deal belonging to the company" },
    },
    required: ["id"],
  },
  async execute(args) {
    const { id } = z.object({ id: z.string().min(1) }).parse(args);
    const graph = await getCrmGraph();
    // Lead ids are the familiar ones, so a deal id resolves up to its company.
    const companyId = graph.companies.some((c) => c.id === id)
      ? id
      : graph.deals.find((d) => d.id === id)?.companyId;
    const detail = companyId ? await getCompanyDetail(companyId) : null;
    if (!detail) return { ok: false, error: `No company or deal matches id '${id}'.` };

    return {
      ok: true,
      company: companyBrief(detail.company),
      deals: detail.deals.map((d) => ({
        id: d.id,
        name: d.name,
        stage: d.stage,
        outcome: d.outcome,
        dealType: d.dealType,
        budgetEur: d.economics.budget == null ? null : Math.round(d.economics.budget),
        lastContact: d.lastContact,
        followUpDate: d.followUpDate,
      })),
      proposals: detail.proposals.map((p) => ({
        id: p.id,
        dealId: p.dealId,
        revision: p.revision,
        valueEur: Math.round(p.value),
        status: p.status,
        sentAt: p.sentAt,
        decidedAt: p.decidedAt,
      })),
    };
  },
};

const proposalPipeline: CopilotTool = {
  name: "proposal_pipeline",
  description:
    "The money view of proposals: how much value is sitting with clients awaiting a decision, how many proposals are sent/accepted/rejected, the real proposal win rate, plus open and weighted pipeline and total repeat business. Use this for 'how much is out awaiting a decision?' and for win rates — proposals are recorded separately from stages, so these are actual euros sent, counting only the newest revision per deal (a re-quote is never double counted). pipeline_summary counts leads by stage; this counts money on real proposals.",
  parameters: { type: "object", properties: {} },
  async execute() {
    const [money, graph] = await Promise.all([getPipelineMoney(), getCrmGraph()]);
    // Counts describe deals, not paperwork: a deal re-quoted three times is one
    // negotiation, so only its live revision is counted.
    const current = currentProposals(graph.proposals);
    return {
      awaitingDecisionEur: Math.round(money.awaitingDecision),
      sentCount: proposalsWithStatus(current, "sent").length,
      acceptedCount: proposalsWithStatus(current, "accepted").length,
      rejectedCount: proposalsWithStatus(current, "rejected").length,
      proposalWinRate: money.proposalWinRate,
      openPipelineEur: Math.round(money.openPipeline),
      weightedPipelineEur: Math.round(money.weightedPipeline),
      repeatValueEur: Math.round(money.repeatValue),
      companiesWithRepeatBusiness: money.companiesWithRepeatBusiness,
    };
  },
};

// ---------------------------------------------------------------------------
// Write tools (role-gated + audited; outreach never auto-sends)
// ---------------------------------------------------------------------------

const advanceStage: CopilotTool = {
  name: "advance_lead_stage",
  description:
    "Move a lead to a new pipeline stage. Only transitions allowed by the workflow are accepted; illegal jumps are rejected.",
  write: true,
  parameters: {
    type: "object",
    properties: {
      id: { type: "string" },
      to: { type: "string", enum: [...BRAND_STATUSES] },
    },
    required: ["id", "to"],
  },
  async execute(args, ctx) {
    const { id, to } = z.object({ id: z.string().min(1), to: z.enum(asEnum(BRAND_STATUSES)) }).parse(args);
    const store = getBrandStore();
    const brand = await store.get(id);
    if (!brand) return { ok: false, error: "Lead not found." };
    const target = to as BrandStatus;
    if (brand.status === target) return { ok: true, id, status: target, note: "Already at that stage." };
    if (!canTransition(brand.status, target)) {
      return { ok: false, error: `Illegal transition ${brand.status ?? "unset"} → ${target}.` };
    }
    const patch = statusSideEffects(brand, target, todayYmd());
    await store.save({ ...brand, status: target, ...patch });
    await logAudit({
      actorId: ctx.user.id,
      actorName: `${ctx.user.name} (via copilot)`,
      action: "status.change",
      entity: "brand",
      entityId: id,
      summary: `Copilot moved ${brand.name}: ${brand.status ?? "unset"} → ${target}`,
    });
    return { ok: true, id, name: brand.name, status: target };
  },
};

const draftOutreach: CopilotTool = {
  name: "draft_outreach",
  description:
    "Draft a templated outreach email for a lead. It is only SAVED — never sent. Admins get a draft; members get a pending-approval request an admin must send.",
  write: true,
  parameters: {
    type: "object",
    properties: {
      id: { type: "string" },
      template: { type: "string", enum: OUTREACH_TEMPLATES.map((t) => t.id) },
      to: { type: "string", description: "Override recipient email (defaults to the lead's contact email)" },
    },
    required: ["id"],
  },
  async execute(args, ctx) {
    const a = z
      .object({
        id: z.string().min(1),
        template: z.string().optional(),
        to: z.string().email().optional(),
      })
      .parse(args);
    const brand = await getBrand(a.id);
    if (!brand) return { ok: false, error: "Lead not found." };
    const recipient = a.to ?? brand.email;
    if (!recipient) return { ok: false, error: "No recipient email — add a contact email to the lead first." };

    const templateId = OUTREACH_TEMPLATES.some((t) => t.id === a.template) ? a.template! : DEFAULT_TEMPLATE_ID;
    const rendered = renderTemplate(templateId, { brand, senderName: ctx.user.name });
    const now = new Date().toISOString();
    const record: Outreach = {
      id: randomUUID(),
      brandId: brand.id,
      brandName: brand.name,
      to: recipient,
      subject: rendered.subject,
      body: rendered.body,
      templateId,
      status: ctx.canApprove ? "draft" : "pending_approval",
      createdById: ctx.user.id,
      createdByName: ctx.user.name,
      createdAt: now,
      updatedAt: now,
    };
    await getOutreachStore().create(record);
    await logAudit({
      actorId: ctx.user.id,
      actorName: `${ctx.user.name} (via copilot)`,
      action: "outreach.create",
      entity: "outreach",
      entityId: record.id,
      summary: `Copilot drafted outreach to ${brand.name} (${record.status})`,
    });
    return { ok: true, outreachId: record.id, status: record.status, subject: rendered.subject, to: recipient };
  },
};

const searchDocuments: CopilotTool = {
  name: "search_documents",
  description:
    "Search the user's uploaded documents (files they attached to the chat) and answer grounded in them, with citations. Use this whenever the user asks about their attached documents, files, PDFs, reports or uploaded content.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "The question to answer from the uploaded documents." } },
    required: ["query"],
  },
  async execute(args, ctx) {
    const a = z.object({ query: z.string().min(1) }).parse(args);
    const reg = await getDocRegistryStore().get(ctx.user.id);
    if (!reg.vectorStoreId || reg.files.length === 0) {
      return { empty: true, message: "No documents have been uploaded yet. Use the attach button next to the message box to add one." };
    }
    const { answer, citations } = await answerFromDocuments(reg.vectorStoreId, a.query);
    return { answer, citations, documents: reg.files.map((f) => f.name) };
  },
};

const webSearch: CopilotTool = {
  name: "web_search",
  description:
    "Search the live public web (Grounding with Bing) and answer with citations. Use for current events, market/industry research, company or competitor news, funding, launches, trends, or any external fact NOT in the pipeline data or the user's uploaded documents. Prefer internal pipeline/document data when it exists; use the web to enrich, validate or fill gaps. Returns a synthesized answer plus web sources to cite.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "A focused web search question." } },
    required: ["query"],
  },
  async execute(args) {
    const a = z.object({ query: z.string().min(1) }).parse(args);
    if (!isWebGroundingConfigured()) {
      return { unavailable: true, message: "Web search isn't available in this environment." };
    }
    const { answer, sources } = await groundedWebAnswer(a.query);
    return { answer, sources };
  },
};

export const COPILOT_TOOLS: CopilotTool[] = [
  searchLeads,
  getLead,
  explainScore,
  pipelineSummary,
  topOpportunities,
  listReminders,
  searchCompanies,
  getCompany,
  proposalPipeline,
  advanceStage,
  draftOutreach,
  searchDocuments,
  webSearch,
];

export function getToolByName(name: string): CopilotTool | undefined {
  return COPILOT_TOOLS.find((t) => t.name === name);
}

/** Function-calling schema (name/description/parameters) for the model / Foundry agent. */
export function toolSchemas() {
  return COPILOT_TOOLS.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
