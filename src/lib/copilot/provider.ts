import "server-only";
import { getVisibleBrands } from "@/lib/leads/visible";
import { runTool, type ToolRun } from "./dispatch";
import { toolSchemas } from "./tools";
import { b, parseBlocks, type Block, type LeadCardData } from "./blocks";
import { blocksResponseSchema } from "./schema";
import type { SessionUser } from "@/lib/auth/guards";
import { OUTREACH_TEMPLATES } from "@/lib/mail/templates";

export interface CopilotTurn {
  blocks: Block[];
  toolRuns: ToolRun[];
  provider: string;
}

export interface AskOptions {
  reasoning?: boolean;
}

export interface CopilotProvider {
  readonly name: string;
  ask(message: string, user: SessionUser, opts?: AskOptions): Promise<CopilotTurn>;
}

export const SYSTEM_PROMPT = `You are the OOVIE BD Copilot — the business-development intelligence assistant built into OOVIE's "BD Intelligence" platform. OOVIE Studios creates AI-native music and video experiences for brands; you help the BD team run their client pipeline: finding and ranking leads, explaining scores, surfacing whitespace and opportunities, planning outreach, and researching brands, industries and markets. You know this product inside out and can explain anything about it.

# THE PLATFORM
BD Intelligence turns OOVIE's "Business Development – Client Segmentation" workbook into a live, scored, searchable web app. It is built from six source tabs: Brands Operative (the CRM pipeline of ~64 leads), Brand Data (the scoring engine, ~45 scored brands), Brand Analysis (per-industry rollup), Sales Strategy (the go-to-market playbook), AgentsAgencies (agency/talent partners) and Agency Data. Everything the user sees is derived from this data, kept clean and current.

# DATA MODEL
A lead (brand) has: name, status, priority, owner, point of contact (POC), email, industry, initial-contact date, last-contact date, follow-up date, closing/failed date, notes, and — if scored — six sub-scores.
· Statuses (pipeline stages): Still to open → Early → Follow Up → Advanced → Deal Closed, plus Recurring, Back to Attack and Did not work out.
· Priorities: Hot, Warm, Cold.
· Industries: Financial/Finance, FMCG, Fashion, Tech/Telecom, Automotive, Consultancy/Professional Services, Fair, Other.
· Above the leads sits a company → deal → proposal model: a lead IS a deal (one engagement), and a company can have several deals with us over time, so the client relationship is tracked separately from any single engagement.
· A company rolls up lifetime value (everything ever won) and repeatValue — what the relationship earned beyond its first win, i.e. genuine repeat business.
· Proposals are their own records (value, revision, sent/accepted/rejected), so "how much is out awaiting a decision" and the win rate are real money and real outcomes rather than inferred from a stage; only the newest sent revision of a deal counts, so a re-quote is never double counted.

# SCORING MODEL (be able to explain this precisely)
Leads are ranked by PRIORITY, a 0–100 score built from two axes that are kept apart on purpose.
OPPORTUNITY (0–100) = what the deal is worth: the budget discounted by how much evidence backs it (Confirmed 1.0, Estimated 0.6, unstated 0.4), capped at €80k, contributing 75%; plus Strategic Value (0–3: a logo, a referral source, a reference case) contributing at most the remaining 25%, so a free project can stay visible without outranking paid work.
WINNABILITY (0–100) = whether it will actually close: stage win-probability 45%, freshness 25% (halves every six months of silence, floored at a quarter), accessibility 15%, receptivity 15%.
PRIORITY = round(√(OPPORTUNITY × WINNABILITY)). It is a geometric mean, so weakness on one axis cannot be averaged away by strength on the other — a zero-opportunity deal scores zero however easy it is. Grades: A ≥ 65, B ≥ 45, C ≥ 25, else D.
EASE (0–100, average of Customization, Accessibility, Receptivity and Alignment) is reported and breaks ties, but is NEVER blended into priority — letting "easy" inflate the ranking was the flaw in the previous model.
The quadrant plots Opportunity (Y) against Winnability (X) at thresholds 35 and 45: Pursue (high/high), Invest (high opportunity, low winnability), Quick win (low opportunity, high winnability), Park (low/low).
EXPECTED VALUE in euros = adjusted budget × stage probability × freshness. Shown beside priority, never folded into it.
The six 0–5 sub-scores still exist as inputs: Tempo (now the deal's expected or actual DURATION, not contact recency), Budget, Customization/Service (5 = productised … 1 = bespoke), Accessibility, Alignment (fit with OOVIE's message) and Receptivity. The old 0–5 Lead Score is still returned as legacyLeadScore for comparison only — never lead with it.

# SECTIONS (all under /dashboard)
· Overview — headline KPIs (total pipeline, probability-weighted value, deals closed, % of pipeline scored), the stage funnel, the priority quadrant and the industry scorecard.
· Pipeline — the full, editable lead list (the Brands Operative tab, live). Search by brand/POC/notes; filter by status and owner; add or edit leads; save named views; export; click a brand to open its detail page (full score breakdown, activity/audit, outreach history and one-click status transitions).
· Scoring — the transparent weighted model above, explained.
· Industries — per-segment analysis plus the Sales Strategy playbook (what each industry needs and how to pitch it).
· Whitespace — market penetration vs. total addressable market, an opportunity map and market sizing, to show where to expand.
· Data Quality — continuous checks that flag missing fields, unscored leads and stale contacts.
· Copilot — this chat.

# FEATURES & HOW TO USE THEM
· Roles: admins vs members. The first registered user becomes admin. Admins approve and send outreach, delete leads, and see the Team page and Activity (audit trail); members can edit leads and draft outreach. Roles are managed on the Team page (top-bar people icon, admins only).
· Reminders: follow-up dates become reminders — a bell in the top bar counts what's due today; the Reminders inbox lists everything with snooze and done.
· Outreach & Outbox: on a lead, "Reach out" composes an email from a template; a member's message becomes "pending approval"; an admin reviews and sends it from the Outbox (top-bar envelope). Nothing is sent without approval.
· Audit trail: every change is logged with who/what/when on the Activity page (admins only).
· Saved views: save a search + filter + sort combination as a named view on the Pipeline and return to it in one click.
· Export: any table can be downloaded as CSV, JSON, Markdown, Excel (.xlsx) or PDF from its "Export" menu; exports respect the current filters. Lead detail pages can also copy a summary or email as Markdown.
· Command palette: press ⌘K (Ctrl-K on Windows/Linux) anywhere to search a lead by name, jump to any section, or run a quick action (ask the Copilot, replay the tutorial, sign out).
· Guided tour: the "?" button in the top bar replays the interactive product tour.

# YOUR CAPABILITIES (the Copilot)
You reply as live, generative UI — charts, tables, lead cards, callouts — grounded in real data via tools:
· Reads: search_leads, get_lead, explain_score, pipeline_summary, top_opportunities, list_reminders, search_companies, get_company, proposal_pipeline.
· Leads/deals are individual engagements (search_leads, get_lead); companies are the client relationship and its repeat business (search_companies, get_company — which also accepts a lead id). Money sent out and proposal win rates come from proposal_pipeline.
· Rankings cover live deals only — won and lost leads are excluded from "top leads" style answers. Say so when it matters, and use pipeline_summary's open* figures when describing live pipeline.
· Writes (role-gated, always logged, surfaced as buttons — never silent): advance_lead_stage; draft_outreach (drafts only — an admin sends).
· search_documents — answer from files the user has uploaded to this chat.
· web_search — live public web (Grounding with Bing) for market/industry/company research and current events.
Around the chat the user can also: toggle "Think deeply" (routes tough questions to a reasoning model and shows its thinking), tap the mic to ask out loud (speech-to-text) and press "Listen" to hear answers read aloud (the Luca voice), attach a document to chat with it, and keep conversation history (New chat / resume past chats).

# HOW YOU ANSWER
· Ground every data answer in tool results — never invent leads, numbers, scores, dates or sources. If tools return nothing relevant, say so and suggest the next step.
· Route tools deliberately: pipeline questions → the pipeline tools; questions about the user's uploaded files → search_documents; research, current events or anything outside the pipeline and documents → web_search (prefer internal data when it exists; use the web to enrich, validate or fill gaps).
· For questions about the platform itself — what it is, how to use it, its features, the scoring methodology, or where to find something — answer directly and accurately from the overview above; you do not need a tool for those.
· When you use web_search, base the answer on its result and always finish with a \`sources\` block (title + url), keeping any inline [n] markers aligned to it.
· You act as the signed-in user and respect their permissions. You may DRAFT outreach but never send it. Surface write actions as buttons; never perform them silently.
· Compose every answer as an ordered array of typed UI blocks (heading, text, metrics, chart, table, leadCard/leadGrid, callout, recommendation, list, timeline, sources, actions) — not plain prose. Be concise, concrete and decision-oriented: lead with the answer, then the evidence.`;

const eur = (n: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

function toLeadCard(x: Record<string, unknown>): LeadCardData {
  return {
    id: String(x.id),
    name: String(x.name),
    status: (x.status as string) ?? null,
    priority: (x.priority as string) ?? null,
    industry: (x.industry as string) ?? null,
    score: (x.leadScore as number) ?? null,
    budgetEur: (x.budgetEur as number) ?? null,
    quadrant: (x.quadrant as string) ?? null,
    winProbability: (x.winProbability as number) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Local preview provider — composes grounded BLOCKS over the real tools.
// Works fully offline; swaps to Foundry automatically once configured.
// ---------------------------------------------------------------------------
class LocalCopilotProvider implements CopilotProvider {
  readonly name = "local-preview";

  private async resolveLead(message: string): Promise<{ id: string; name: string } | null> {
    const brands = await getVisibleBrands();
    const lower = message.toLowerCase();
    const hit = brands
      .filter((br) => lower.includes(br.name.toLowerCase()))
      .sort((a, c) => c.name.length - a.name.length)[0];
    return hit ? { id: hit.id, name: hit.name } : null;
  }

  async ask(message: string, user: SessionUser, opts: AskOptions = {}): Promise<CopilotTurn> {
    const m = message.toLowerCase();
    const runs: ToolRun[] = [];
    const run = async (tool: string, args: Record<string, unknown> = {}) => {
      const r = await runTool(tool, args, user);
      runs.push(r);
      return r.data as Record<string, unknown> | undefined;
    };
    const done = (blocks: Block[], reasoning?: string): CopilotTurn => ({
      blocks: opts.reasoning && reasoning ? [b.reasoning(reasoning), ...blocks] : blocks,
      toolRuns: runs,
      provider: this.name,
    });

    // explain score
    if (/(why|explain|how).*(score|scored|rated|rating)/.test(m) || /score.*(of|for)\s/.test(m)) {
      const lead = await this.resolveLead(message);
      if (!lead) return done([b.text("Which lead's score should I explain? Name the brand.")]);
      const d = await run("explain_score", { id: lead.id });
      if (!d || d.scored === false) return done([b.callout(`**${lead.name}** hasn't been scored yet.`, "warning")]);
      const s = d.subScores as Record<string, number>;
      const opp = d.opportunity as { score: number; adjustedBudgetEur: number } | null;
      const win = d.winnability as { score: number } | null;
      return done(
        [
          b.heading(lead.name, {
            eyebrow: "Priority breakdown",
            subtitle: `Priority ${d.priorityScore} · grade ${d.grade} · ${d.quadrant}`,
          }),
          b.metrics([
            { label: "Opportunity", value: String(opp?.score ?? "—"), tone: "cyan" },
            { label: "Winnability", value: String(win?.score ?? "—"), tone: "mint" },
            { label: "Priority", value: String(d.priorityScore ?? "—"), tone: "brand" },
          ]),
          b.chart("progress", {
            title: "Six sub-scores (0–5)",
            max: 5,
            series: [
              { label: "Tempo", value: s.tempo, tone: "cyan" },
              { label: "Budget", value: s.budget, tone: "cyan" },
              { label: "Customization", value: s.customization, tone: "cyan" },
              { label: "Accessibility", value: s.accessibility, tone: "mint" },
              { label: "Alignment", value: s.alignment, tone: "mint" },
              { label: "Receptivity", value: s.receptivity, tone: "mint" },
            ],
          }),
          b.text(
            "Priority = **√(opportunity × winnability)**. A geometric mean, so weakness on one axis can't be averaged away by strength on the other — and ease of delivery is reported separately, never blended in.",
          ),
          b.actions([
            { label: "Draft outreach", tool: "draft_outreach", args: { id: lead.id }, style: "primary" },
            { label: "Open lead", tool: "open_lead", args: { id: lead.id }, style: "ghost" },
          ]),
        ],
        `Identify ${lead.name}, pull its priority breakdown, then surface the two axes, the six sub-scores as a progress chart, and how they combine.`,
      );
    }

    // draft outreach
    if (/(draft|write|compose|prepare).*(outreach|email|message|intro|note)/.test(m)) {
      const lead = await this.resolveLead(message);
      if (!lead) return done([b.text("Who should I draft outreach to? Name the lead.")]);
      const template = OUTREACH_TEMPLATES.find((t) => m.includes(t.id) || m.includes(t.label.toLowerCase()))?.id;
      const d = await run("draft_outreach", { id: lead.id, ...(template ? { template } : {}) });
      if (!d?.ok) return done([b.callout(`I couldn't draft that: ${(d?.error as string) ?? "unknown error"}.`, "danger")]);
      return done([
        b.callout(
          `Drafted **“${d.subject}”** to ${d.to}. ` +
            (d.status === "pending_approval" ? "Queued for an admin to approve and send." : "It's in your outbox — send it there."),
          "success",
          "Outreach drafted",
        ),
        b.actions([{ label: "Open outbox", tool: "open_outbox", args: {}, style: "ghost" }]),
      ]);
    }

    // advance stage
    if (/(move|advance|progress|change|set).*(stage|status|to\s)/.test(m)) {
      const lead = await this.resolveLead(message);
      if (!lead) return done([b.text("Which lead should I move, and to which stage?")]);
      const { BRAND_STATUSES } = await import("@/lib/vocab");
      const to = BRAND_STATUSES.find((st) => m.includes(st.toLowerCase()));
      if (!to) return done([b.text(`What stage should **${lead.name}** move to? (e.g. Advanced, Follow Up, Deal Closed)`)]);
      const d = await run("advance_lead_stage", { id: lead.id, to });
      if (!d?.ok) return done([b.callout(`Couldn't move **${lead.name}**: ${(d?.error as string) ?? "not allowed"}.`, "danger")]);
      return done([b.callout(`Moved **${lead.name}** to **${to}**.`, "success")]);
    }

    // reminders
    if (/(remind|follow[- ]?up|overdue|due|this week|to call|chase|outstanding)/.test(m)) {
      const bucket = m.includes("overdue") ? "overdue" : m.includes("today") ? "today" : undefined;
      const d = (await run("list_reminders", bucket ? { bucket } : {})) as
        | { count: number; reminders: { id: string; name: string; days: number; bucket: string; owner: string | null }[] }
        | undefined;
      if (!d || d.count === 0) return done([b.callout("Nothing due — you're all caught up on follow-ups.", "success")]);
      const overdue = d.reminders.filter((r) => r.bucket === "overdue").length;
      const today = d.reminders.filter((r) => r.bucket === "today").length;
      return done(
        [
          b.heading("Follow-ups", { eyebrow: "Reminders", subtitle: `${d.count} scheduled` }),
          b.metrics([
            { label: "Overdue", value: overdue, tone: "rose" },
            { label: "Today", value: today, tone: "amber" },
            { label: "Upcoming", value: d.count - overdue - today, tone: "neutral" },
          ]),
          b.table(
            [
              { key: "name", label: "Lead" },
              { key: "when", label: "When" },
              { key: "owner", label: "Owner" },
            ],
            d.reminders.slice(0, 8).map((r) => ({
              name: r.name,
              when: r.days < 0 ? `${Math.abs(r.days)}d overdue` : r.days === 0 ? "today" : `in ${r.days}d`,
              owner: r.owner ?? "—",
            })),
          ),
        ],
        bucket ? `Filter reminders to "${bucket}", then tabulate.` : "Bucket reminders into overdue/today/upcoming and tabulate the soonest.",
      );
    }

    // opportunities / whitespace
    if (/(opportunit|whitespace|untapped|biggest market|where.*(grow|expand)|which (industry|segment|market))/.test(m)) {
      const d = (await run("top_opportunities", { limit: 6 })) as
        | { industries: { industry: string; opportunityScore: number; whitespace: number | null; valuation: string | null; approached: number }[] }
        | undefined;
      const rows = d?.industries ?? [];
      return done(
        [
          b.heading("Whitespace by industry", { eyebrow: "Opportunity", subtitle: "Value weight × untapped share" }),
          b.chart("bar", {
            max: 1,
            series: rows.map((i) => ({
              label: i.industry,
              value: i.opportunityScore,
              tone: i.valuation === "High" ? "mint" : i.valuation === "Medium" ? "amber" : "neutral",
            })),
          }),
          b.table(
            [
              { key: "industry", label: "Industry" },
              { key: "approached", label: "Approached", align: "right", kind: "number" },
              { key: "whitespace", label: "Untapped", align: "right", kind: "number" },
              { key: "valuation", label: "Value", kind: "badge" },
            ],
            rows.map((i) => ({ industry: i.industry, approached: i.approached, whitespace: i.whitespace ?? 0, valuation: i.valuation ?? "—" })),
          ),
          b.recommendation(
            "Where to push next",
            rows[0]
              ? `**${rows[0].industry}** has the richest whitespace — ${rows[0].whitespace ?? 0} untapped companies at ${rows[0].valuation ?? "—"} value.`
              : "No clear leader.",
            0.7,
          ),
        ],
        "Rank industries by opportunity score, chart them, table approached vs untapped, then recommend the leader.",
      );
    }

    // hot / top leads
    if (/(hot lead|top lead|best lead|priorit|who should i (call|contact|chase)|top \d+)/.test(m)) {
      const isHot = m.includes("hot");
      const d = (await run("search_leads", { ...(isHot ? { priority: "Hot Lead" } : {}), sortBy: "leadScore", limit: 6 })) as
        | { count: number; leads: Record<string, unknown>[] }
        | undefined;
      const leads = d?.leads ?? [];
      if (leads.length === 0) return done([b.callout("No leads match that yet.", "warning")]);
      return done(
        [
          b.heading(isHot ? "Top hot leads" : "Highest-scoring leads", { eyebrow: "Targets", subtitle: `${leads.length} shown` }),
          b.leadGrid(leads.map(toLeadCard)),
        ],
        isHot ? "Filter to Hot Lead priority, sort by priority score, render as lead cards." : "Sort all leads by priority score, render the top as cards.",
      );
    }

    // pipeline summary
    if (/(pipeline|summary|overview|how many|weighted|closed|total leads|state of|how'?s|health)/.test(m)) {
      const d = (await run("pipeline_summary")) as
        | { totalLeads: number; scored: number; hotLeads: number; dealsClosed: number; weightedValueEur: number; byStatus: Record<string, number> }
        | undefined;
      if (!d) return done([b.callout("Couldn't read the pipeline.", "danger")]);
      const palette = ["brand", "cyan", "mint", "amber", "rose", "violet", "neutral"] as const;
      return done(
        [
          b.heading("Pipeline overview", { eyebrow: "Command center", subtitle: `Snapshot of ${d.totalLeads} leads` }),
          b.metrics([
            { label: "Total leads", value: d.totalLeads, tone: "brand" },
            { label: "Scored", value: d.scored, tone: "cyan" },
            { label: "Hot leads", value: d.hotLeads, tone: "rose" },
            { label: "Deals closed", value: d.dealsClosed, tone: "mint" },
            { label: "Weighted value", value: eur(d.weightedValueEur), tone: "amber" },
          ]),
          b.chart("donut", {
            title: "Leads by stage",
            series: Object.entries(d.byStatus).map(([label, value], i) => ({ label, value, tone: palette[i % palette.length] })),
          }),
        ],
        "Read the pipeline totals, then show headline metrics and a donut of the stage distribution.",
      );
    }

    // fallback — lead lookup or search
    const lead = await this.resolveLead(message);
    if (lead) {
      const d = (await run("get_lead", { id: lead.id })) as Record<string, unknown> | undefined;
      if (d?.found) {
        return done([
          b.heading(lead.name, { eyebrow: "Lead" }),
          b.leadCard(toLeadCard(d)),
          b.actions([
            { label: "Explain score", tool: "ask", args: { message: `Why is ${lead.name} scored that way?` }, style: "ghost" },
            { label: "Draft outreach", tool: "draft_outreach", args: { id: lead.id }, style: "primary" },
          ]),
        ]);
      }
    }
    const sd = (await run("search_leads", { query: message, limit: 6 })) as { count: number; leads: Record<string, unknown>[] } | undefined;
    if (sd && sd.count > 0) {
      return done([b.heading("Matches", { eyebrow: "Search", subtitle: `${sd.count} found` }), b.leadGrid(sd.leads.map(toLeadCard))]);
    }
    return done([
      b.heading("BD Copilot", { eyebrow: "How I can help" }),
      b.list(
        [
          "“Summarise the pipeline” — KPIs + stage donut",
          "“Top hot leads to call this week” — ranked lead cards",
          "“Why is Alibaba scored that way?” — score breakdown chart",
          "“Where's our biggest untapped market?” — whitespace analysis",
          "“Draft an intro to Generali” — queued outreach",
        ],
        "check",
      ),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Foundry provider — structured-output blocks via an OpenAI-compatible model,
// with a function-calling loop. Activates when COPILOT_CHAT_ENDPOINT is set
// (keyless via managed identity, or COPILOT_API_KEY). Wired for deploy.
// ---------------------------------------------------------------------------
class FoundryCopilotProvider implements CopilotProvider {
  readonly name = "foundry";

  private async authHeader(): Promise<Record<string, string>> {
    if (process.env.COPILOT_API_KEY) return { "api-key": process.env.COPILOT_API_KEY };
    const { DefaultAzureCredential } = await import("@azure/identity");
    const token = await new DefaultAzureCredential().getToken("https://cognitiveservices.azure.com/.default");
    return { Authorization: `Bearer ${token?.token ?? ""}` };
  }

  async ask(message: string, user: SessionUser, opts: AskOptions = {}): Promise<CopilotTurn> {
    const endpoint = process.env.COPILOT_CHAT_ENDPOINT!;
    const model = opts.reasoning
      ? process.env.COPILOT_REASONING_MODEL ?? process.env.COPILOT_MODEL ?? "gpt-5.4-mini"
      : process.env.COPILOT_MODEL ?? "gpt-5.4-mini";
    const headers = { "content-type": "application/json", ...(await this.authHeader()) };
    const messages: Record<string, unknown>[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: message },
    ];
    const runs: ToolRun[] = [];

    for (let step = 0; step < 6; step++) {
      const body: Record<string, unknown> = {
        model,
        messages,
        tools: toolSchemas(),
        tool_choice: "auto",
        response_format: { type: "json_schema", json_schema: blocksResponseSchema() },
      };
      if (opts.reasoning && process.env.COPILOT_REASONING_MODEL) body.reasoning_effort = "medium";

      const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`Foundry model call failed: ${res.status}`);
      const json = (await res.json()) as { choices: { message: Record<string, unknown> }[] };
      const msg = json.choices[0]?.message ?? {};
      messages.push(msg);

      const toolCalls = (msg.tool_calls as { id: string; function: { name: string; arguments: string } }[]) ?? [];
      if (toolCalls.length === 0) {
        const blocks = parseBlocks(safeJson(String(msg.content ?? "")));
        return { blocks: blocks.length ? blocks : [b.text(String(msg.content ?? ""))], toolRuns: runs, provider: this.name };
      }
      for (const call of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          /* ignore malformed args */
        }
        const r = await runTool(call.function.name, args, user);
        runs.push(r);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(r.data ?? { error: r.error }) });
      }
    }
    return { blocks: [b.text("I wasn't able to finish that request.")], toolRuns: runs, provider: this.name };
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function isFoundryConfigured(): boolean {
  return !!process.env.COPILOT_CHAT_ENDPOINT;
}

let provider: CopilotProvider | undefined;

export function getCopilotProvider(): CopilotProvider {
  if (provider) return provider;
  provider = isFoundryConfigured() ? new FoundryCopilotProvider() : new LocalCopilotProvider();
  return provider;
}
