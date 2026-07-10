import "server-only";
import { getBrands } from "@/lib/data";
import { runTool, type ToolRun } from "./dispatch";
import { toolSchemas } from "./tools";
import type { SessionUser } from "@/lib/auth/guards";
import { OUTREACH_TEMPLATES } from "@/lib/mail/templates";

export interface CopilotTurn {
  reply: string;
  toolRuns: ToolRun[];
  provider: string;
}

export interface CopilotProvider {
  readonly name: string;
  ask(message: string, user: SessionUser): Promise<CopilotTurn>;
}

export const SYSTEM_PROMPT = [
  "You are the OOVIE BD copilot, an assistant for the business-development pipeline.",
  "OOVIE Studios builds AI-native music and video experiences for brands.",
  "Answer ONLY from tool results — never invent numbers, scores or lead names.",
  "You act as the signed-in user; respect their permissions.",
  "You may DRAFT outreach but never send it — an admin approves and sends.",
  "Be concise and specific; cite lead names/ids and the figures the tools return.",
].join(" ");

const eur = (n: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

// ---------------------------------------------------------------------------
// Local preview provider — deterministic intent routing over the real tools.
// Works fully offline; swaps to Foundry automatically once configured.
// ---------------------------------------------------------------------------
class LocalCopilotProvider implements CopilotProvider {
  readonly name = "local-preview";

  private async resolveLeadId(message: string): Promise<{ id: string; name: string } | null> {
    const brands = await getBrands();
    const lower = message.toLowerCase();
    const hit = brands
      .filter((b) => lower.includes(b.name.toLowerCase()))
      .sort((a, b) => b.name.length - a.name.length)[0];
    return hit ? { id: hit.id, name: hit.name } : null;
  }

  async ask(message: string, user: SessionUser): Promise<CopilotTurn> {
    const m = message.toLowerCase();
    const runs: ToolRun[] = [];
    const push = async (tool: string, args: Record<string, unknown> = {}) => {
      const r = await runTool(tool, args, user);
      runs.push(r);
      return r;
    };
    const reply = (text: string): CopilotTurn => ({ reply: text, toolRuns: runs, provider: this.name });

    // explain score
    if (/(why|explain|how).*(score|scored|rated|rating)/.test(m) || /score.*(of|for)\s/.test(m)) {
      const lead = await this.resolveLeadId(message);
      if (!lead) return reply("Which lead's score should I explain? Name the brand and I'll break it down.");
      const r = await push("explain_score", { id: lead.id });
      const d = r.data as Record<string, unknown> | undefined;
      if (!d || d.scored === false) return reply(`**${lead.name}** hasn't been scored yet, so there's no breakdown.`);
      const s = d.subScores as Record<string, number>;
      return reply(
        `**${lead.name}** scores **${d.leadScore}** (${d.quadrant}).\n\n` +
          `- Economical efficiency **${d.economicalEfficiency}** — budget ${s.budget}, customization ${s.customization}, tempo ${s.tempo}\n` +
          `- Ease of access **${d.easeOfAccess}** — accessibility ${s.accessibility}, alignment ${s.alignment}, receptivity ${s.receptivity}\n\n` +
          `Lead score = economical efficiency × 0.55 + ease of access × 0.45.`,
      );
    }

    // draft outreach
    if (/(draft|write|compose|prepare).*(outreach|email|message|intro|note)/.test(m)) {
      const lead = await this.resolveLeadId(message);
      if (!lead) return reply("Who should I draft outreach to? Name the lead.");
      const template = OUTREACH_TEMPLATES.find((t) => m.includes(t.id) || m.includes(t.label.toLowerCase()))?.id;
      const r = await push("draft_outreach", { id: lead.id, ...(template ? { template } : {}) });
      const d = r.data as Record<string, unknown> | undefined;
      if (!r.ok || !d?.ok) return reply(`I couldn't draft that: ${r.error ?? (d?.error as string) ?? "unknown error"}.`);
      const status = d.status as string;
      return reply(
        `Drafted **“${d.subject}”** to ${d.to} for **${lead.name}**. ` +
          (status === "pending_approval"
            ? "It's queued for an admin to approve and send."
            : "It's in your outbox — open it there to send.") +
          " I never send messages myself.",
      );
    }

    // advance stage
    if (/(move|advance|progress|change|set).*(stage|status|to\s)/.test(m)) {
      const lead = await this.resolveLeadId(message);
      if (!lead) return reply("Which lead should I move, and to which stage?");
      const { BRAND_STATUSES } = await import("@/lib/vocab");
      const to = BRAND_STATUSES.find((s) => m.includes(s.toLowerCase()));
      if (!to) return reply(`What stage should **${lead.name}** move to? (e.g. Advanced, Follow Up, Deal Closed)`);
      const r = await push("advance_lead_stage", { id: lead.id, to });
      const d = r.data as Record<string, unknown> | undefined;
      if (!d?.ok) return reply(`I couldn't move **${lead.name}**: ${(d?.error as string) ?? r.error ?? "not allowed"}.`);
      return reply(`Moved **${lead.name}** to **${to}**.`);
    }

    // reminders
    if (/(remind|follow[- ]?up|overdue|due|this week|to call|chase|outstanding)/.test(m)) {
      const bucket = m.includes("overdue") ? "overdue" : m.includes("today") ? "today" : undefined;
      const r = await push("list_reminders", bucket ? { bucket } : {});
      const d = r.data as { count: number; reminders: { name: string; days: number; bucket: string }[] };
      if (d.count === 0) return reply("Nothing due — you're all caught up on follow-ups.");
      const lines = d.reminders
        .slice(0, 8)
        .map((x) => `- **${x.name}** — ${x.days < 0 ? `${Math.abs(x.days)}d overdue` : x.days === 0 ? "due today" : `in ${x.days}d`}`);
      return reply(`You have **${d.count}** follow-up${d.count === 1 ? "" : "s"}${bucket ? ` (${bucket})` : ""}:\n\n${lines.join("\n")}`);
    }

    // opportunities / whitespace
    if (/(opportunit|whitespace|untapped|biggest market|where.*(grow|expand)|which (industry|segment|market))/.test(m)) {
      const r = await push("top_opportunities", { limit: 5 });
      const d = r.data as { industries: { industry: string; opportunityScore: number; whitespace: number | null; valuation: string | null }[] };
      const lines = d.industries.map(
        (i) => `- **${i.industry}** — opportunity ${i.opportunityScore}${i.whitespace != null ? `, ~${i.whitespace} untapped` : ""}${i.valuation ? `, ${i.valuation} value` : ""}`,
      );
      return reply(`Richest whitespace right now:\n\n${lines.join("\n")}`);
    }

    // hot / top leads
    if (/(hot lead|top lead|best lead|priorit|who should i (call|contact|chase)|top \d+)/.test(m)) {
      const isHot = m.includes("hot");
      const r = await push("search_leads", { ...(isHot ? { priority: "Hot Lead" } : {}), sortBy: "leadScore", limit: 5 });
      const d = r.data as { count: number; leads: { name: string; leadScore: number | null; status: string | null; quadrant: string | null }[] };
      if (d.leads.length === 0) return reply("No leads match that yet.");
      const lines = d.leads.map((l) => `- **${l.name}** — score ${l.leadScore ?? "—"}${l.quadrant ? ` (${l.quadrant})` : ""}${l.status ? `, ${l.status}` : ""}`);
      return reply(`${isHot ? "Top hot leads" : "Highest-scoring leads"}:\n\n${lines.join("\n")}`);
    }

    // pipeline summary
    if (/(pipeline|summary|overview|how many|weighted|closed|total leads|state of|how'?s|health)/.test(m)) {
      const r = await push("pipeline_summary");
      const d = r.data as { totalLeads: number; scored: number; hotLeads: number; dealsClosed: number; weightedValueEur: number };
      return reply(
        `**${d.totalLeads}** leads (${d.scored} scored). Weighted pipeline value **${eur(d.weightedValueEur)}**. ` +
          `**${d.hotLeads}** hot leads · **${d.dealsClosed}** deals closed.`,
      );
    }

    // fallback — try a lead lookup, else search
    const lead = await this.resolveLeadId(message);
    if (lead) {
      const r = await push("get_lead", { id: lead.id });
      const d = r.data as Record<string, unknown>;
      return reply(
        `**${lead.name}** — ${(d.status as string) ?? "no stage"}, ${(d.industry as string) ?? "industry n/a"}. ` +
          `Score ${d.leadScore ?? "—"}${d.quadrant ? ` (${d.quadrant})` : ""}, budget ${d.budgetEur ? eur(d.budgetEur as number) : "—"}. ` +
          `Ask me to explain the score or draft outreach.`,
      );
    }
    const r = await push("search_leads", { query: message, limit: 5 });
    const d = r.data as { count: number; leads: { name: string; status: string | null }[] };
    if (d.count > 0) {
      const lines = d.leads.map((l) => `- **${l.name}**${l.status ? ` — ${l.status}` : ""}`);
      return reply(`Here's what I found:\n\n${lines.join("\n")}`);
    }
    return reply(
      "I can help with the pipeline. Try: *“top hot leads to call this week”*, *“why is Alibaba scored that way”*, " +
        "*“where's our biggest untapped market”*, or *“draft an intro to Generali”*.",
    );
  }
}

// ---------------------------------------------------------------------------
// Foundry provider — OpenAI-compatible function-calling loop against a deployed
// Foundry model. Activates when COPILOT_CHAT_ENDPOINT is set (keyless via
// managed identity, or COPILOT_API_KEY). Untested locally; wired for deploy.
// ---------------------------------------------------------------------------
class FoundryCopilotProvider implements CopilotProvider {
  readonly name = "foundry";

  private async authHeader(): Promise<Record<string, string>> {
    if (process.env.COPILOT_API_KEY) return { "api-key": process.env.COPILOT_API_KEY };
    const { DefaultAzureCredential } = await import("@azure/identity");
    const token = await new DefaultAzureCredential().getToken("https://cognitiveservices.azure.com/.default");
    return { Authorization: `Bearer ${token?.token ?? ""}` };
  }

  async ask(message: string, user: SessionUser): Promise<CopilotTurn> {
    const endpoint = process.env.COPILOT_CHAT_ENDPOINT!;
    const model = process.env.COPILOT_MODEL ?? "gpt-5.4-mini";
    const headers = { "content-type": "application/json", ...(await this.authHeader()) };
    const messages: Record<string, unknown>[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: message },
    ];
    const runs: ToolRun[] = [];

    for (let step = 0; step < 5; step++) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, messages, tools: toolSchemas(), tool_choice: "auto" }),
      });
      if (!res.ok) throw new Error(`Foundry model call failed: ${res.status}`);
      const json = (await res.json()) as { choices: { message: Record<string, unknown> }[] };
      const msg = json.choices[0]?.message ?? {};
      messages.push(msg);

      const toolCalls = (msg.tool_calls as { id: string; function: { name: string; arguments: string } }[]) ?? [];
      if (toolCalls.length === 0) {
        return { reply: (msg.content as string) ?? "", toolRuns: runs, provider: this.name };
      }
      for (const call of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          /* ignore malformed args */
        }
        const run = await runTool(call.function.name, args, user);
        runs.push(run);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(run.data ?? { error: run.error }) });
      }
    }
    return { reply: "I wasn't able to finish that request.", toolRuns: runs, provider: this.name };
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
