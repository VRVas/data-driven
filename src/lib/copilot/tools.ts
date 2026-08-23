import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDataset, getLiveIndustries } from "@/lib/data";
import { getVisibleBrands, visibleLead, writableLead } from "@/lib/leads/visible";
import { getBrandStore } from "@/lib/store/brands";
import { getOutreachStore, type Outreach } from "@/lib/store/outreach";
import { answerFromDocuments } from "@/lib/copilot/documents";
import { groundedWebAnswer, isWebGroundingConfigured } from "@/lib/copilot/websearch";
import { getDocRegistryStore } from "@/lib/store/documents";
import { logAudit } from "@/lib/store/audit";
import { leadScore, weightedValue, winProbability, effectiveTempoMonths } from "@/lib/scoring";
import { priorityOf } from "@/lib/priority";
import { openLeads, outcomeOf } from "@/lib/lifecycle";
import { opportunityScore, penetration, whitespace } from "@/lib/tam";
import { getCrmGraph, getCompanyDetail, getDealWithCompany, getPipelineMoney } from "@/lib/crm/graph";
import { proposalsWithStatus, currentProposals } from "@/lib/crm/logic";
import { pipelineHealth, withHealth, healthOf } from "@/lib/pipeline/health";
import { budgetVariance } from "@/lib/pipeline/budget";
import { can } from "@/lib/auth/authorize";
import type { PermissionKey } from "@/lib/auth/catalogue";
import type { Company } from "@/lib/crm/types";
import { remindersFrom } from "@/lib/reminders";
import { advanceStage as applyStageChange, todayYmd } from "@/lib/workflow";
import { renderTemplate, DEFAULT_TEMPLATE_ID, OUTREACH_TEMPLATES } from "@/lib/mail/templates";
import { BRAND_STATUSES, PRIORITIES, INDUSTRIES } from "@/lib/vocab";
import type { Brand, BrandStatus } from "@/lib/types";
import type { SessionUser } from "@/lib/auth/guards";
import { EXTRA_TOOLS } from "./tools-extra";
import { platformSpec } from "./platform-spec";

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
  /**
   * The permission this tool needs, enforced centrally in `runTool`.
   *
   * Declared per tool rather than checked inside each `execute`, because the
   * chat is a second way into the same data as the UI: a tool that forgets is
   * a way to do through conversation what the screens refuse.
   */
  permission?: PermissionKey;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

const asEnum = (v: readonly string[]) => v as unknown as [string, ...string[]];

/** Compact, model-friendly view of a lead (no UI tokens, only facts + computed values). */
function leadBrief(b: Brand) {
  const s = b.scores;
  const p = priorityOf(b);
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
    priorityScore: p?.priority ?? null,
    grade: p?.grade ?? null,
    quadrant: p?.quadrant ?? null,
    opportunity: p ? Math.round(p.opportunity) : null,
    winnability: p ? Math.round(p.winnability) : null,
    ease: p ? Math.round(p.ease) : null,
    expectedValueEur: p ? Math.round(p.expectedValueEur) : null,
    // The old 0-5 average, kept for one cycle so "why did this move?" is answerable.
    legacyLeadScore: leadScore(b),
    strategicValue: b.strategicValue ?? 0,
    winProbability: winProbability(b.status),
    weightedValueEur: Math.round(weightedValue(b)),
    waitingOn: b.waitingOn ?? null,
    nextStep: b.nextStep ?? null,
    followUpDate: b.followUpDate,
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
    // Named for what it measures: proposal_pipeline reports a different rate
    // over sent paperwork, and an unqualified "winRate" invited the model to
    // treat the two as interchangeable.
    dealWinRate: r.dealWinRate,
    lastContact: r.lastContact,
  };
}

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

const searchLeads: CopilotTool = {
  name: "search_leads",
  permission: "lead:read",
  description:
    "Search and rank leads by any combination of status, priority, industry, owner or free text. Returns compact summaries with the priority score (0-100), its A-D grade, the Pursue/Invest/Quick win/Park quadrant, and expected value in euros. Ranked by priority by default. Ranks only live deals unless asked otherwise: pass outcome='won'/'lost'/'any' to include finished ones.",
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
      minPriority: { type: "number", description: "Minimum priority score (0–100). Grades: A ≥ 65, B ≥ 45, C ≥ 25." },
      sortBy: { type: "string", enum: ["priority", "expectedValue", "weightedValue", "budget", "name"] },
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
        minPriority: z.number().optional(),
        sortBy: z.enum(["priority", "expectedValue", "weightedValue", "budget", "name"]).optional(),
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
    if (a.minPriority != null) brands = brands.filter((b) => (priorityOf(b)?.priority ?? -1) >= a.minPriority!);

    const briefs = brands.map(leadBrief);
    const sortBy = a.sortBy ?? "priority";
    briefs.sort((x, y) => {
      if (sortBy === "name") return x.name.localeCompare(y.name);
      const key =
        sortBy === "budget" ? "budgetEur"
        : sortBy === "weightedValue" ? "weightedValueEur"
        : sortBy === "expectedValue" ? "expectedValueEur"
        : "priorityScore";
      return (Number(y[key] ?? -1) || -1) - (Number(x[key] ?? -1) || -1);
    });

    return { count: briefs.length, outcomeFilter, leads: briefs.slice(0, a.limit ?? 10) };
  },
};

const getLead: CopilotTool = {
  name: "get_lead",
  permission: "lead:read",
  description:
    "Full detail of one lead: priority breakdown, who owes the next move and how overdue it is, expected or measured deal duration, estimated versus accepted budget, the company it belongs to, timeline, scores and outreach count.",
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "Lead id (slug), e.g. 'alibaba'" } },
    required: ["id"],
  },
  async execute(args) {
    const { id } = z.object({ id: z.string().min(1) }).parse(args);
    const b = await visibleLead(id);
    if (!b) return { found: false, id };
    const [outreach, crm] = await Promise.all([
      getOutreachStore().listForBrand(id),
      getDealWithCompany(id),
    ]);
    const health = healthOf(b, crm?.proposals ?? []);
    const tempo = effectiveTempoMonths(b);
    const variance = budgetVariance(b);
    return {
      found: true,
      ...leadBrief(b),
      aliases: b.aliases,
      notes: b.notes,
      email: b.email,
      strategicReason: b.strategicReason ?? null,
      nextMove: {
        waitingOn: health.waitingOn,
        basis: health.source,
        dueDate: health.dueDate,
        daysLate: health.daysLate,
        lateOnUs: health.lateOnUs,
        lateOnThem: health.lateOnThem,
        daysSinceContact: health.daysSinceContact,
        goneQuiet: health.stale,
      },
      pace: {
        months: tempo.months == null ? null : Number(tempo.months.toFixed(1)),
        basis: tempo.basis,
        note:
          tempo.basis === "actual"
            ? "measured from first contact to close"
            : "estimated when the lead opened",
      },
      budgetOutlook: variance
        ? {
            estimatedEur: variance.estimated,
            acceptedEur: variance.actual,
            deltaEur: variance.deltaEur,
            deltaPct: variance.deltaPct == null ? null : Math.round(variance.deltaPct),
          }
        : { estimatedEur: b.scores?.budget ?? null, acceptedEur: null, deltaEur: null, deltaPct: null },
      company: crm ? { id: crm.company.id, name: crm.company.name, dealCount: crm.company.rollup.openDealCount } : null,
      timeline: {
        initialContact: b.initialContact,
        lastContact: b.lastContact,
        followUpDate: b.followUpDate,
        closingFailed: b.closingFailed,
      },
      scores: b.scores ?? null,
      outreachCount: outreach.length,
    };
  },
};

const explainScore: CopilotTool = {
  name: "explain_score",
  permission: "scoring:read",
  description:
    "Explain how a lead's priority is composed: the opportunity axis (budget discounted by how much evidence backs it, plus capped strategic value), the winnability axis (stage, freshness, accessibility, receptivity), the ease index that is deliberately never blended in, and the geometric mean that combines the first two. Use whenever asked why a lead ranks where it does, or why its position changed.",
  parameters: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
  async execute(args) {
    const { id } = z.object({ id: z.string().min(1) }).parse(args);
    const b = await visibleLead(id);
    if (!b) return { found: false, id };
    if (!b.scores) return { found: true, id, scored: false, note: "This lead has not been scored yet." };
    const s = b.scores;
    const p = priorityOf(b);
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
      priorityScore: p?.priority ?? null,
      grade: p?.grade ?? null,
      quadrant: p?.quadrant ?? null,
      opportunity: p
        ? {
            score: Math.round(p.opportunity),
            adjustedBudgetEur: Math.round(p.adjustedBudget),
            moneyIndex: Math.round(p.moneyIndex),
            strategicIndex: Math.round(p.strategicIndex),
            note: "budget × how much evidence backs it, capped at €80k; strategic value adds at most a quarter",
          }
        : null,
      winnability: p
        ? {
            score: Math.round(p.winnability),
            stageProbability: p.winProbability,
            recency: Number(p.recency.toFixed(3)),
            note: "stage 45%, freshness 25%, accessibility 15%, receptivity 15%",
          }
        : null,
      ease: p ? Math.round(p.ease) : null,
      expectedValueEur: p ? Math.round(p.expectedValueEur) : null,
      legacyLeadScore: leadScore(b),
      formula:
        "priority = round(sqrt(opportunity * winnability)) — a geometric mean, so weakness on one axis cannot be averaged away by strength on the other. Ease is reported but never blended, and expected value in euros is shown separately.",
    };
  },
};

const pipelineSummary: CopilotTool = {
  name: "pipeline_summary",
  permission: "lead:read",
  description:
    "Summarise the whole pipeline: lead counts by outcome and stage, scored coverage, hot-lead and closed counts, and the weighted (probability-adjusted) value of the live book. Counts leads; use proposal_pipeline for money on real proposals.",
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
      // Open deals only. Weighting a won deal by its stage probability of 1.0
      // adds banked money to a figure that claims to be pipeline.
      weightedValueEur: Math.round(live.reduce((sum, b) => sum + weightedValue(b), 0)),
      byStatus,
    };
  },
};

const topOpportunities: CopilotTool = {
  name: "top_opportunities",
  permission: "tam:read",
  description:
    "Rank industries by whitespace opportunity (value weight × untapped share). Highlights high-value, barely-approached segments.",
  parameters: {
    type: "object",
    properties: { limit: { type: "integer", minimum: 1, maximum: 10 } },
  },
  async execute(args) {
    const { limit } = z.object({ limit: z.number().int().min(1).max(10).optional() }).parse(args);
    const industries = await getLiveIndustries();
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

const pipelineHealthTool: CopilotTool = {
  name: "pipeline_health",
  permission: "lead:read",
  description:
    "Who owes the next move on the pipeline and who is late making it. Separates being late to REPLY to a client (on us) from being late to CHASE one (on them) — an overdue count alone cannot tell a backlog from a chase list. Also returns euros sitting with clients awaiting a greenlight, open leads nobody owns, and leads gone quiet. Use for 'who are we late with?', 'what do I owe today?', 'how much is waiting for a greenlight?'.",
  parameters: {
    type: "object",
    properties: {
      side: {
        type: "string",
        enum: ["us", "them", "untriaged", "stale"],
        description: "Restrict the returned leads to one problem. Omit for the headline counts plus all of them.",
      },
      limit: { type: "number", description: "Max leads to return (default 10)" },
    },
  },
  async execute(args) {
    const { side, limit } = z
      .object({ side: z.enum(["us", "them", "untriaged", "stale"]).optional(), limit: z.number().min(1).max(50).optional() })
      .parse(args);

    const [brands, graph] = await Promise.all([getVisibleBrands(), getCrmGraph()]);
    const summary = pipelineHealth(brands, graph.proposals);
    const rows = withHealth(brands, graph.proposals).filter((r) => outcomeOf(r.brand.status) === "open");

    const matches = rows.filter(({ health }) =>
      side === "us" ? health.lateOnUs
      : side === "them" ? health.lateOnThem
      : side === "untriaged" ? health.untriaged
      : side === "stale" ? health.stale
      : health.lateOnUs || health.lateOnThem,
    );

    return {
      openLeads: summary.open,
      lateOnUs: summary.lateOnUs,
      lateOnThem: summary.lateOnThem,
      untriaged: summary.untriaged,
      goneQuiet: summary.stale,
      awaitingGreenlightEur: Math.round(summary.awaitingGreenlightEur),
      leads: matches
        .sort((a, b) => b.health.daysLate - a.health.daysLate)
        .slice(0, limit ?? 10)
        .map(({ brand, health }) => ({
          id: brand.id,
          name: brand.name,
          owner: brand.owner,
          waitingOn: health.waitingOn,
          nextStep: brand.nextStep ?? null,
          dueDate: health.dueDate,
          daysLate: health.daysLate,
          daysSinceContact: health.daysSinceContact,
        })),
    };
  },
};

const listReminders: CopilotTool = {
  name: "list_reminders",
  permission: "reminder:read",
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
        followUpDate: r.date,
        days: r.days,
        bucket: r.bucket,
        owner: r.brand.owner,
      })),
    };
  },
};

const searchCompanies: CopilotTool = {
  name: "search_companies",
  permission: "lead:read",
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
  permission: "lead:read",
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
    const showProposals = await can("proposal:read");

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
      proposals: showProposals
        ? detail.proposals.map((p) => ({
            id: p.id,
            dealId: p.dealId,
            revision: p.revision,
            valueEur: Math.round(p.value),
            status: p.status,
            sentAt: p.sentAt,
            decidedAt: p.decidedAt,
          }))
        : [],
    };
  },
};

const proposalPipeline: CopilotTool = {
  name: "proposal_pipeline",
  permission: "proposal:read",
  description:
    "The money view of proposals: how much value is sitting with clients awaiting a decision, how many proposals are sent/accepted/rejected, the real proposal win rate, plus open and weighted pipeline and total repeat business. Use this for 'how much is out awaiting a decision?' and for win rates — proposals are recorded separately from stages, so these are actual euros sent, counting only the newest revision per deal (a re-quote is never double counted). pipeline_summary counts leads by stage; this counts money on real proposals.",
  parameters: { type: "object", properties: {} },
  async execute() {
    if (!(await can("proposal:read"))) {
      return { ok: false, error: "You don't have permission to see proposal figures." };
    }
    const [money, graph] = await Promise.all([getPipelineMoney(), getCrmGraph()]);
    // Counts describe deals, not paperwork: a deal re-quoted three times is one
    // negotiation, so only its live revision is counted.
    const current = currentProposals(graph.proposals);
    // sentCount has to be counted the same way awaitingDecisionEur is, or the
    // count and the euros describe different sets of paperwork.
    const openIds = new Set(graph.deals.filter((d) => d.outcome === "open").map((d) => d.id));
    return {
      awaitingDecisionEur: Math.round(money.awaitingDecision),
      sentCount: proposalsWithStatus(current, "sent").filter((p) => openIds.has(p.dealId)).length,
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
  permission: "lead:stage:advance",
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
    const brand = await writableLead(id, "lead:stage:advance");
    if (!brand) return { ok: false, error: "Lead not found." };
    const target = to as BrandStatus;
    if (brand.status === target) return { ok: true, id, status: target, note: "Already at that stage." };

    const next = applyStageChange(brand, target, todayYmd());
    if ("error" in next) {
      return { ok: false, error: `Illegal transition ${brand.status ?? "unset"} \u2192 ${target}.` };
    }

    await store.save(next);
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
  permission: "outreach:compose",
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
    const brand = await writableLead(a.id, "outreach:compose");
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
  permission: "copilot:documents",
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
  permission: "copilot:websearch",
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

/**
 * The product manual, read out of the registries that define it.
 *
 * Defined here rather than in tools-extra so it can hold COPILOT_TOOLS without
 * closing an import cycle — it reads the list inside execute, after the module
 * has finished initialising.
 */
const explainPlatform: CopilotTool = {
  name: "explain_platform",
  permission: "copilot:use",
  description:
    "Everything about the platform itself: what it is, the data model and its vocabularies, the legal stage transitions, every section with its route and what you can do there, step-by-step instructions for common tasks ('how do I delete a lead', 'how do I merge two companies', 'how do I export'), the permission model with the full catalogue and the seeded profiles, and the copilot's own complete capability list with the permission each tool needs. Use for any question about how to use the app, where a control lives, what something means, or what you yourself can do. For how a NUMBER is calculated use explain_model; for what one specific person is allowed to do use what_can_i_do.",
  parameters: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        enum: ["all", "sections", "howDoI", "permissions", "copilot", "dataModel"],
        description: "Narrow the answer. Defaults to everything.",
      },
    },
  },
  async execute(args) {
    const { topic } = z
      .object({ topic: z.enum(["all", "sections", "howDoI", "permissions", "copilot", "dataModel"]).optional() })
      .parse(args);

    const spec = platformSpec(
      COPILOT_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        permission: t.permission,
        write: t.write,
      })),
    );
    if (!topic || topic === "all") return spec;
    return { what: spec.what, [topic]: spec[topic] };
  },
};

export const COPILOT_TOOLS: CopilotTool[] = [
  ...EXTRA_TOOLS,
  searchLeads,
  getLead,
  explainScore,
  pipelineSummary,
  topOpportunities,
  listReminders,
  pipelineHealthTool,
  searchCompanies,
  getCompany,
  proposalPipeline,
  advanceStage,
  draftOutreach,
  searchDocuments,
  webSearch,
  explainPlatform,
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
