import "server-only";
import { getBrands } from "@/lib/data";
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

export const SYSTEM_PROMPT = [
  "You are the OOVIE BD copilot, an assistant for the business-development pipeline.",
  "OOVIE Studios builds AI-native music and video experiences for brands.",
  "Answer ONLY from tool results — never invent numbers, scores or lead names.",
  "You act as the signed-in user; respect their permissions.",
  "You may DRAFT outreach but never send it — an admin approves and sends.",
  "Compose every answer as an ordered array of typed UI blocks (heading, metrics,",
  "chart, table, leadCard/leadGrid, callout, recommendation, actions) — not plain prose.",
].join(" ");

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
    const brands = await getBrands();
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
      return done(
        [
          b.heading(lead.name, { eyebrow: "Score breakdown", subtitle: `Lead score ${d.leadScore} · ${d.quadrant}` }),
          b.metrics([
            { label: "Economical efficiency", value: Number(d.economicalEfficiency).toFixed(2), tone: "cyan" },
            { label: "Ease of access", value: Number(d.easeOfAccess).toFixed(2), tone: "mint" },
            { label: "Lead score", value: Number(d.leadScore).toFixed(2), tone: "brand" },
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
          b.text("Lead score = **economical efficiency × 0.55 + ease of access × 0.45**."),
          b.actions([
            { label: "Draft outreach", tool: "draft_outreach", args: { id: lead.id }, style: "primary" },
            { label: "Open lead", tool: "open_lead", args: { id: lead.id }, style: "ghost" },
          ]),
        ],
        `Identify ${lead.name}, pull its score breakdown, then surface the two aggregates, the six sub-scores as a progress chart, and the blend formula.`,
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
        isHot ? "Filter to Hot Lead priority, sort by lead score, render as lead cards." : "Sort all leads by composite lead score, render the top as cards.",
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
