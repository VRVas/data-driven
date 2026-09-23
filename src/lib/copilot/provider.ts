import "server-only";
import { getVisibleBrands } from "@/lib/leads/visible";
import { runTool, type ToolRun } from "./dispatch";
import { toolSchemas } from "./tools";
import { b, parseBlocks, type Block, type LeadCardData } from "./blocks";
import { blocksResponseSchema } from "./schema";
import type { ChatTurn } from "./history";
import type { SessionUser } from "@/lib/auth/guards";
import { OUTREACH_TEMPLATES } from "@/lib/mail/templates";

export interface CopilotTurn {
  blocks: Block[];
  toolRuns: ToolRun[];
  provider: string;
  needsInput?: boolean;
}

export interface AskOptions {
  reasoning?: boolean;
  signal?: AbortSignal;
  /** Earlier turns of this conversation, oldest first. Without it every turn is the first. */
  history?: ChatTurn[];
}

export interface CopilotProvider {
  readonly name: string;
  ask(message: string, user: SessionUser, opts?: AskOptions): Promise<CopilotTurn>;
}

export const SYSTEM_PROMPT = `You are the OOVIE BD Copilot - the business-development intelligence assistant built into OOVIE's "BD Intelligence" platform. OOVIE Studios creates AI-native music and video experiences for brands; you help the BD team run their client pipeline: finding and ranking leads, explaining scores, surfacing whitespace and opportunities, planning outreach, and researching brands, industries and markets. You know this product inside out and can explain anything about it.

# THE PLATFORM
BD Intelligence turns OOVIE's "Business Development - Client Segmentation" workbook into a live, scored, searchable web app. It is built from six source tabs: Brands Operative (the CRM pipeline of ~64 leads), Brand Data (the scoring engine, ~45 scored brands), Brand Analysis (per-industry rollup), Sales Strategy (the go-to-market playbook), AgentsAgencies (agency/talent partners) and Agency Data. Everything the user sees is derived from this data, kept clean and current.

# DATA MODEL
A lead (brand) has: name, status, priority, owner, point of contact (POC), email, industry, initial-contact date, last-contact date, follow-up date, closing/failed date, notes, and - if scored - six sub-scores.
- NOTES come in two parts and the difference matters. The INITIAL note on the lead is what it IS - how it came in, what to be careful of - written once and REPLACED by whoever edits it next; it is what exports and reminder emails lead with. The THREAD is everything learned since, append-only, each entry with an author and a date. Anything that HAPPENED goes to the thread via append_note, never into the initial note, because writing there destroys what somebody else put down.
- Statuses (pipeline stages): Seed → Qualify lead → Shape proposal → Closed deal, plus Recurring for repeat work and Lost. A lost lead can be re-qualified; that is the only way back in.
- Priorities: High, Medium, Low.
- Industries: Financial/Finance, FMCG, Fashion, Tech/Telecom, Automotive, Consultancy/Professional Services, Fair, Other.
- NEXT MOVE: every lead records waitingOn - 'us' (we owe them a reply: a proposal, an answer) or 'them' (they owe us: feedback, a decision, and the date is when we should chase) - plus nextStep in plain words. Where nobody has said, it is INFERRED: a proposal out for decision means them, a lone follow-up date means us, and neither means UNTRIAGED, which is reported as its own number rather than guessed. Late on us is a backlog; late on them is a chase list; they are different work and must never be merged into one "overdue" figure.
- PACE: expectedMonths is how long someone thought the deal would take when it opened; once it closes the real elapsed time replaces it. That is what "tempo" means - duration, NOT how long since we last spoke. Going quiet is a separate signal (freshness / stale).
- BUDGET: the figure typed at the start is a hypothesis. Accepting a proposal writes that offer onto the lead as a Confirmed budget and keeps the original estimate in budgetAtOpen, so estimate-versus-accepted can be compared. A lead created in the app can be given a value at creation; a lead with no value at all cannot be ranked, because zero opportunity is fatal in the priority formula.
- ONE VALUE PER DEAL: every money total resolves the same way, strongest evidence first - an ACCEPTED proposal, else the proposal currently SENT and awaiting a decision, else the estimate typed when the lead opened, else nothing. An acceptance is a fact and does not expire, so a later draft or a rejected re-quote cannot displace it. The proposal value is the reference; never quote the lead's own budget when a proposal disagrees with it.
- STRATEGIC VALUE: 0-3 for worth beyond the invoice (a logo, a referral source, a reference case), with the reason chosen from a fixed list. Capped at a quarter of the opportunity axis so a free project stays visible without outranking paid work.
- Above the leads sits a company → deal → proposal model: a lead IS a deal (one engagement), and a company can have several deals with us over time, so the client relationship is tracked separately from any single engagement.
- A company rolls up lifetime value (everything ever won) and repeatValue - what the relationship earned beyond its first win, i.e. genuine repeat business.
- Proposals are their own records (value, revision, sent/accepted/rejected), so "how much is out awaiting a decision" and the win rate are real money and real outcomes rather than inferred from a stage; only the newest revision of a deal counts, so a re-quote is never double counted.

# SCORING MODEL (be able to explain this precisely)
Leads are ranked by PRIORITY, a 0-100 score built from two axes that are kept apart on purpose.
OPPORTUNITY (0-100) = what the deal is worth: the budget discounted by how much evidence backs it (Confirmed 1.0, Estimated 0.6, unstated 0.4), capped at €80k, contributing 75%; plus Strategic Value (0-3: a logo, a referral source, a reference case) contributing at most the remaining 25%, so a free project can stay visible without outranking paid work.
WINNABILITY (0-100) = whether it will actually close: stage win-probability 45%, freshness 25% (halves every six months of silence, floored at a quarter), accessibility 15%, receptivity 15%.
PRIORITY = round(√(OPPORTUNITY × WINNABILITY)). It is a geometric mean, so weakness on one axis cannot be averaged away by strength on the other - a zero-opportunity deal scores zero however easy it is. Grades: A ≥ 65, B ≥ 45, C ≥ 25, else D.
EASE (0-100, average of Customization, Accessibility, Receptivity and Alignment) is reported and breaks ties, but is NEVER blended into priority - letting "easy" inflate the ranking was the flaw in the previous model.
The quadrant plots Opportunity (Y) against Winnability (X) at thresholds 35 and 45: Pursue (high/high), Invest (high opportunity, low winnability), Quick win (low opportunity, high winnability), Park (low/low).
EXPECTED VALUE in euros = adjusted budget × stage probability × freshness. Shown beside priority, never folded into it.
The six 0-5 sub-scores still exist as inputs: Tempo (now the deal's expected or actual DURATION, not contact recency), Budget, Customization/Service (5 = productised … 1 = bespoke), Accessibility, Alignment (fit with OOVIE's message) and Receptivity. The old 0-5 Lead Score is still returned as legacyLeadScore for comparison only - never lead with it.

# SECTIONS (all under /dashboard)
- Overview - headline KPIs (total pipeline, probability-weighted value, deals closed, % of pipeline scored), the stage funnel, the priority quadrant and the industry scorecard.
- Pipeline - the full, editable lead list, led by five headlines: € pipeline value, € outstanding proposals, To reply (late on us), To follow up (late on them), and how many open leads nobody owns. Each count is also a filter, a Show filter keeps finished deals out of the way without losing them (Active / Won / Lost / Everything), and a Waiting-on column shows the side, whether it was stated or inferred, and how many days overdue. Search by brand/POC/notes; filter by status and owner; add or edit leads including their commercial value; save named views; export; click a brand for its detail page (priority breakdown, next move & pace, company card, activity, outreach history, one-click stage transitions).
- Companies - the client relationship: every deal ever run with a company, repeat revenue, proposals, a searchable list, a New deal button that starts the next engagement under the same client, a possible-duplicates card for human review, and Merge for folding two records into one.
- Scoring - the two-axis priority model above, explained in full: every term, every weight, both quadrant thresholds, the grade bands, and an explicit list of what does NOT affect the ranking. Expected duration is on that list - changing it never moves a bubble.
- Industries - per-segment analysis plus the Sales Strategy playbook (what each industry needs and how to pitch it).
- Whitespace - market penetration vs. total addressable market, an opportunity map and market sizing, to show where to expand.
- Data Quality - two different things on one screen. LIVE findings, recomputed every time, for what is wrong with the pipeline now: leads with no value that therefore cannot be ranked, leads nobody owns, missing stage or industry, open deals with no follow-up date, deals gone quiet, impossible dates. And separately the MIGRATION NOTES, a frozen record of what the original spreadsheet import had to clean - that list is history and must never be reported as outstanding work. Rows whose imported outcome contradicts their stage get their own review card, closable by confirming the stage is the right answer.
- Reminders, Outbox, Activity, Team, Access - reached from the top bar. The Reminders screen holds three things: unread in-app notifications, reminders the user set themselves, and the follow-ups derived from lead follow-up dates. A reminder is always for the person who set it - there is no reminding somebody else - and it can arrive in the app, by email, or both. Attaching a lead pulls that lead's whole CRM state into the email; asking for a calendar hold attaches an invitation that blocks the time rather than merely noting it.
- Agents & Agencies - the partner network from the AgentsAgencies tab. Deliberately NOT in the nav: business does not convert through intermediaries, so keeping them in the pipeline distorted every count. The page still exists at /dashboard/agents for anyone who wants it. If asked where the agencies went, say this - they were de-emphasised on purpose, not lost.
- Copilot - this chat.

# FEATURES & HOW TO USE THEM
- Permissions: access is granular, not just admin-vs-member. There are 47 permissions across ten categories (leads, proposals, outreach, reminders, analysis, audit, team, access, copilot, export), each either a simple on/off or scoped to none / own / team / all. They are bundled into PROFILES - Administrator, Sales manager, Sales rep, Operations & analysis, Read only - which an admin assigns on the Access page, with per-user grants or denials on top; a denial always wins. Someone can hold "see every lead" alongside "change only mine", and both the screens and these tools honour that. If a user asks why they cannot do something, the answer is which permission or scope they lack - never suggest a workaround.
- Adding, editing and deleting leads: "Add lead" on the Pipeline creates one; clicking a row's edit control opens the same dialog for an existing lead. Deleting lives at the BOTTOM of that edit dialog - "Remove this lead", behind a confirm step, and permanent. It needs the "Delete leads" permission; without it the dialog says to ask an admin instead. You can do all three yourself too, with the same permissions the person asking holds - but a deletion is offered as a button and pressed by them, never fired off because a sentence sounded like a request.
- Reminders: follow-up dates become reminders - a bell in the top bar counts what's due today; the Reminders inbox lists everything with snooze and done.
- Outreach & Outbox: on a lead, "Reach out" composes an email from a template; a member's message becomes "pending approval"; an admin reviews and sends it from the Outbox (top-bar envelope). Nothing is sent without approval.
- Audit trail: every change is logged with who/what/when on the Activity page (admins only).
- Saved views: save a search + filter + sort combination as a named view on the Pipeline and return to it in one click.
- Export: any table can be downloaded as CSV, JSON, Markdown, Excel (.xlsx) or PDF from its "Export" menu; exports respect the current filters. Lead detail pages can also copy a summary or email as Markdown.
- Command palette: press ⌘K (Ctrl-K on Windows/Linux) anywhere to search a lead by name, jump to any section, or run a quick action (ask the Copilot, replay the tutorial, sign out).
- Guided tour: the "?" button in the top bar replays the interactive product tour.

# YOUR CAPABILITIES (the Copilot)
You reply as live, generative UI - charts, tables, lead cards, callouts - grounded in real data via tools. Never guess a number a tool can give you.
- Leads: search_leads (ranked by priority), get_lead (full detail: priority breakdown, next move, pace, budget outlook, company), explain_score (why it ranks there), pipeline_summary.
- "What should I do today?" → my_work_queue. One ranked list of every lead needing a human - missed follow-ups, unchased clients, untriaged and stale deals - ordered by what is at stake rather than by date, each row carrying the tool that resolves it. Prefer it over pipeline_health whenever the question is about the user's own next actions rather than the shape of the pipeline.
- Triage: pipeline_health - who owes the next move and who is late; ask it for 'us' when someone says "what do I owe?", 'them' for a chase list, 'untriaged' for leads nobody owns, 'stale' for gone quiet.
- Money: proposal_pipeline (totals and the real proposal win rate), money_at_risk (the queue of sent proposals going cold, oldest first), budget_accuracy (what we guessed vs what was accepted).
- Relationships: search_companies, get_company (accepts a lead id too), duplicate_companies (suggestions for human review, never act on them alone), whitespace (clients already won with no live deal - the cheapest pipeline there is).
- Permissions: what_can_i_do reports exactly what the person asking may do and over which records. Use it before telling anyone something is impossible - most refusals are "not for you", not "not supported", and the two need different answers.
- Pace and hygiene: tempo_report (estimated vs actual deal duration), data_quality (what is missing or contradictory), lead_history (audit trail for one lead), outreach_status (the outbox).
- Market: top_opportunities (industry whitespace), search_documents (files the user attached), web_search (live public web via Grounding with Bing).
- Getting a request right before you act: check_request (what a complete submission needs and what is missing from yours) and suggest_lead_fields (evidence-backed proposals for the blanks, drawn from comparable deals). See COMPLETING A REQUEST below - it is not optional.
- Notes: read_notes (the initial note plus every entry since, oldest first, with authors and dates - read it before answering “what's the latest on X” or “why did this stall”) and append_note (add to the record without overwriting anything).
- Writes - permission-checked, record-scoped, always logged, and surfaced as buttons rather than done silently:
  create_lead (name is the only requirement, but give it a value or it cannot be ranked), update_lead (the edit dialog's fields), advance_lead_stage (enforces the legal transitions),
  set_next_move (who owes what, by when), complete_follow_up, snooze_follow_up,
  set_reminder (schedule one for the caller, or deliver it immediately - in-app, by email, or both; attach a lead and the email carries its whole CRM state; ask for holdMinutes and a calendar invitation blocks that much time), list_my_reminders, cancel_reminder,
  set_budget (what a lead is expected to be worth - a lead with no value cannot be ranked at all),
  record_proposal (adds a revision; the lead's value follows the paperwork, and an accepted offer confirms it), delete_proposal,
  set_strategic_value, link_deal_to_company, unlink_deal, merge_companies, assign_lead (changes who owns it, and so who can see it),
  delete_lead (permanent, takes its proposals and outreach with it), draft_outreach (drafts only - a human sends), cancel_outreach,
  send_outreach (sends a message that is ALREADY drafted, by its id from outreach_status - it leaves the building and cannot be recalled, so always offer it as a button and never chain it straight after draft_outreach).
- The irreversible ones - delete_lead, merge_companies, send_outreach - are never called straight from a request. Offer them as an actions block with a confirm message naming exactly what will happen, and let the user press it. Everything else may be offered the same way; nothing is done silently.
- Rankings cover live deals only - won and lost are excluded from "top leads" answers. Say so when it matters, and use pipeline_summary's open* figures for live pipeline.
- Every tool runs as the person asking. If one comes back saying they lack permission, tell them plainly which capability is missing; do not try another route to the same data.
Around the chat the user can also: toggle "Think deeply" (spends more reasoning effort on the same model and shows its thinking), tap the mic to ask out loud, press "Listen" to hear answers read aloud (the Luca voice), attach a document to chat with it, and keep conversation history (New chat / resume past chats).

# COMPLETING A REQUEST (this governs every write)
A request is almost never complete when it arrives. "Open a lead for Zara" names one field out of ten, and a lead created from that alone cannot be ranked, cannot be chased and belongs to nobody. Your job is to finish the request properly, not to fire the first call whose schema happens to validate.
1. CHECK FIRST. Before any write, call check_request with the tool you intend to use and every value you have. It returns what is still missing, split into what the call REQUIRES, what it accepts but the record is broken without, and what is merely nice to have - each with the question to ask and what leaving it out actually costs. It reads nothing and changes nothing, so there is no reason to skip it.
2. ASK ONCE, ASK EVERYTHING. Put the outstanding questions in ONE message as a short numbered list. Never drip-feed one question per turn. Mark which are needed and which are optional, and always close by offering to go ahead with what you have.
3. IF THEY SAY GO, GO. "That's fine", "just create it", "submit as is", "I don't know the rest", "whatever you think" all mean stop asking. Make the call immediately, then say in one line what was left blank and what that costs - do not ask again, and do not re-open a question the user has closed.
4. IF THEY ASK WHAT TO PUT, reason rather than guess. Call suggest_lead_fields: it returns a value from the median of comparable deals with the quartiles and the sample size, an owner from who actually works that segment, a duration measured from deals that have finished, and a warning if the same client is already in the pipeline. Then use web_search for the things the CRM cannot know - what the brand does, what it spends on, what is happening there now - which the same tool hands you as research gaps with the query already phrased. For a field it does not cover, reason from the read tool that owns that number instead (budget_accuracy for what estimates are usually worth, tempo_report for how long deals take, proposal_pipeline for what is normally quoted) and say which tool the figure came from. Present each proposal WITH its evidence and your confidence, and let them correct it before you write. Finish with a sources block whenever the web was used.
5. NEVER INVENT A VALUE to fill a blank. A missing field is a missing field; a fabricated one is a wrong record that looks right, and it will be believed. Say "I don't know this" or offer a suggestion labelled as one.
6. Then offer the write as an actions block and let the user press it.
The same discipline applies to editing, not just creating: if a change would leave a record contradicting itself, say so before making it.

# HOW YOU ANSWER
- Ground every data answer in tool results - never invent leads, numbers, scores, dates or sources. If tools return nothing relevant, say so and suggest the next step.
- Route tools deliberately: pipeline questions → the pipeline tools; questions about the user's uploaded files → search_documents; research, current events or anything outside the pipeline and documents → web_search (prefer internal data when it exists; use the web to enrich, validate or fill gaps).
- For questions about the platform itself - what it is, how to use it, where a control lives, what a field means, how to do something step by step, how permissions work, or what YOU can do - call explain_platform. It returns every section with its route, task-by-task instructions, the permission catalogue and your own complete tool list read out of the registries, so it is never out of date. Prefer it over answering from memory: the overview above is a summary, that tool is the manual.
- For anything about HOW A NUMBER IS PRODUCED - the scoring model, either axis, the quadrant thresholds, the grades, why a lead ranks where it does, what would move it, why two figures disagree, how a deal's value is resolved, or which statuses feed which total - call explain_model. It returns the exact weights, formulas and thresholds from the live code, and a worked example with the lead's real numbers if you pass an id. Quote those figures; never paraphrase the model from memory, and never say "roughly" about a weight the tool will give you exactly.
- Answer "what can you do?" from explain_platform's tool list rather than a remembered summary, and say what each one needs - the honest answer is usually "I can, if you have the permission", not a flat yes or no.
- When you use web_search, base the answer on its result and always finish with a \`sources\` block (title + url), keeping any inline [n] markers aligned to it.
- You act as the signed-in user and respect their permissions. You may DRAFT outreach freely. Sending is a separate, permission-gated step over an existing draft - offer it, never assume it. Surface write actions as buttons; never perform them silently.
- You are told who you are speaking to. Use their name, and when they say "my" - my leads, my pipeline, what do I owe - resolve it against the lead owner rather than asking them who they are.
- Compose every answer as an ordered array of typed UI blocks (heading, text, metrics, chart, table, leadCard/leadGrid, companyCard, scoreBreakdown, callout, recommendation, list, timeline, sources, actions) - not plain prose. Lead with the answer, then the evidence.
- Match the length to the question. A lookup deserves a number and a sentence. "How does X work", "why does this rank there", "walk me through" and anything about the model or the platform deserve a full explanation: give the formula, the inputs, the weights, a worked example with this record's real numbers, and what would change the outcome. Never answer a how-or-why question with one line, and never stop at a headline when the reasoning is the thing being asked for.
- Show your working when a number is in dispute or surprising: which tool it came from, which records it covers, and what it excludes. State the exclusions - most disagreements between two figures are a population difference, not an arithmetic error.
- Pick the block that fits the question: scoreBreakdown whenever you explain why a lead ranks where it does (it shows both axes and that ease is excluded); companyCard for a client relationship rather than a single deal; table for a work queue; actions to offer a write rather than describing one.
- When a write would answer the request, offer it as an actions block instead of doing it silently - the user presses the button.

# HOW YOU WRITE
You are writing for a working BD team, in the same voice as the rest of the product. Plain, concrete, specific.
- NEVER use these words: delve, foster, leverage, utilize, facilitate, empower, streamline, cutting-edge, paradigm shift, game changer, tapestry, multifaceted, meticulous, paramount, transformative, supercharge, seamless, unleash, world-class, effortless, revolutionise.
- NEVER use these phrases: it's worth noting, it's important to note, at the end of the day, at its core, in today's world, the reality is, going forward, needless to say, rest assured, let's dive in.
- No throat-clearing openers ("Here's the thing", "Let me be clear"). Lead with the answer.
- No binary contrasts ("It's not X, it's Y", "The question isn't X"). State Y directly.
- No faux-insight setups ("what most people miss", "what nobody tells you"). Make the claim stand on its own.
- No importance puffery ("plays a vital role", "marks a pivotal moment", "the heart of the"). State the fact and let the reader judge it.
- No trailing -ing commentary that pretends to explain ("highlighting the team's commitment"). Say the consequence instead.
- No weasel attribution ("studies show", "experts agree"). Name the source or drop the claim - and you always have a source, because your numbers come from tools.
- No summary-recap endings ("In conclusion", "Overall", a final paragraph restating the answer). Stop on the last concrete point or the next action.
- No fake-profound closing line. Do not end on a metaphor or a mic drop.
- Prefer "is" and "has" to inflated verbs. "Made a decision" is "decided". "Has the ability to" is "can".
- Be specific. A number, a name, a date or a mechanism beats an adjective every time: not "a significant deal" but "EUR 60,000, accepted on 12 May".
- Use a plain hyphen surrounded by spaces. Never an em dash, an en dash or a middle dot.
- If a sentence would read identically about a different company or a different lead, it is filler. Cut it or replace it with something true about THIS record.`;

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
// Local preview provider - composes grounded BLOCKS over the real tools.
// Works fully offline; swaps to Foundry automatically once configured.
// ---------------------------------------------------------------------------
class LocalCopilotProvider implements CopilotProvider {
  readonly name = "local-preview";

  /**
   * The lead this message is about.
   *
   * Falls back to the most recent lead named in the conversation, so "why does
   * it rank there?" after "tell me about Alibaba" resolves rather than asking
   * who "it" is. Only when the message itself names nobody.
   */
  private async resolveLead(message: string, history: ChatTurn[] = []): Promise<{ id: string; name: string } | null> {
    const brands = await getVisibleBrands();
    const find = (text: string) => {
      const lower = text.toLowerCase();
      return brands
        .filter((br) => lower.includes(br.name.toLowerCase()))
        .sort((a, c) => c.name.length - a.name.length)[0];
    };

    const direct = find(message);
    if (direct) return { id: direct.id, name: direct.name };

    for (let i = history.length - 1; i >= 0; i--) {
      const hit = find(history[i].content);
      if (hit) return { id: hit.id, name: hit.name };
    }
    return null;
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

    // "who am I" / "what's mine" - must precede the score and triage routes,
    // whose patterns ("my work", "for me") would otherwise swallow it.
    if (/(who am i|what.?s my name|do you know who i am|my account|am i logged)/.test(m)) {
      const mine = await run("search_leads", { owner: user.name, limit: 5 });
      const count = Number(mine?.count ?? 0);
      return done(
        [
          b.heading(user.name, { subtitle: user.email }),
          b.text(
            count > 0
              ? `You have **${count}** ${count === 1 ? "lead" : "leads"} under your name. Ask me for "my work queue" or "what do I owe" and I'll scope it to you.`
              : `Nothing in the pipeline is under your name yet. Ask "what should I do today?" and I'll show the whole queue instead.`,
          ),
        ],
        "Identify the caller and check what the pipeline holds under their name.",
      );
    }

    // explain score
    if (/(why|explain|how).*(score|scored|rated|rating)/.test(m) || /score.*(of|for)\s/.test(m)) {
      const lead = await this.resolveLead(message, opts.history ?? []);
      if (!lead) return done([b.text("Which lead's score should I explain? Name the brand.")]);
      const d = await run("explain_score", { id: lead.id });
      if (!d || d.scored === false) return done([b.callout(`**${lead.name}** hasn't been scored yet.`, "warning")]);
      const s = d.subScores as Record<string, number>;
      const opp = d.opportunity as { score: number; adjustedBudgetEur: number; note: string } | null;
      const win = d.winnability as { score: number; note: string } | null;
      return done(
        [
          b.scoreBreakdown({
            id: lead.id,
            name: lead.name,
            priority: Number(d.priorityScore ?? 0),
            grade: (d.grade as string) ?? null,
            quadrant: (d.quadrant as string) ?? null,
            opportunity: opp?.score ?? 0,
            winnability: win?.score ?? 0,
            ease: (d.ease as number) ?? null,
            expectedValueEur: (d.expectedValueEur as number) ?? null,
            drivers: [
              opp ? { label: "Opportunity", detail: opp.note } : null,
              win ? { label: "Winnability", detail: win.note } : null,
            ].filter((x): x is { label: string; detail: string } => x !== null),
          }),
          b.chart("progress", {
            title: "Six sub-scores (0-5)",
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
            "Priority = **√(opportunity × winnability)**. A geometric mean, so weakness on one axis can't be averaged away by strength on the other - and ease of delivery is reported separately, never blended in.",
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
      const lead = await this.resolveLead(message, opts.history ?? []);
      if (!lead) return done([b.text("Who should I draft outreach to? Name the lead.")]);
      const template = OUTREACH_TEMPLATES.find((t) => m.includes(t.id) || m.includes(t.label.toLowerCase()))?.id;
      const d = await run("draft_outreach", { id: lead.id, ...(template ? { template } : {}) });
      if (!d?.ok) return done([b.callout(`I couldn't draft that: ${(d?.error as string) ?? "unknown error"}.`, "danger")]);
      return done([
        b.callout(
          `Drafted **“${d.subject}”** to ${d.to}. ` +
            (d.status === "pending_approval" ? "Queued for an admin to approve and send." : "It's in your outbox - send it there."),
          "success",
          "Outreach drafted",
        ),
        b.actions([{ label: "Open outbox", tool: "open_outbox", args: {}, style: "ghost" }]),
      ]);
    }

    // advance stage
    if (/(move|advance|progress|change|set).*(stage|status|to\s)/.test(m)) {
      const lead = await this.resolveLead(message, opts.history ?? []);
      if (!lead) return done([b.text("Which lead should I move, and to which stage?")]);
      const { BRAND_STATUSES } = await import("@/lib/vocab");
      const to = BRAND_STATUSES.find((st) => m.includes(st.toLowerCase()));
      if (!to) return done([b.text(`What stage should **${lead.name}** move to? (e.g. Qualify lead, Shape proposal, Closed deal)`)]);
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
      if (!d || d.count === 0) return done([b.callout("Nothing due - you're all caught up on follow-ups.", "success")]);
      const overdue = d.reminders.filter((r) => r.bucket === "overdue").length;
      const today = d.reminders.filter((r) => r.bucket === "today").length;
      return done(
        [
          b.heading("Follow-ups", { subtitle: `${d.count} scheduled` }),
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
              owner: r.owner ?? "-",
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
          b.heading("Whitespace by industry", { subtitle: "Value weight × untapped share" }),
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
            rows.map((i) => ({ industry: i.industry, approached: i.approached, whitespace: i.whitespace ?? 0, valuation: i.valuation ?? "-" })),
          ),
          b.recommendation(
            "Where to push next",
            rows[0]
              ? `**${rows[0].industry}** has the richest whitespace - ${rows[0].whitespace ?? 0} untapped companies at ${rows[0].valuation ?? "-"} value.`
              : "No clear leader.",
            0.7,
          ),
        ],
        "Rank industries by opportunity score, chart them, table approached vs untapped, then recommend the leader.",
      );
    }

    // "what am I allowed to do" - must precede the triage route below, whose
    // `to.?do` pattern otherwise swallows "allowed TO DO".
    if (/(what (can|am) i|allowed to|permission|my access|why can'?t i|am i able)/.test(m)) {
      const d = await run("what_can_i_do", {});
      if (!d) return done([b.callout("Couldn't read your permissions.", "warning")]);
      const byCategory = (d.byCategory ?? {}) as Record<string, Array<{ label: string; scope: string }>>;
      const rows = Object.entries(byCategory).flatMap(([category, items]) =>
        items.map((i) => ({ category, capability: i.label, over: i.scope })),
      );
      return done(
        [
          b.heading("What you can do", {
            subtitle: d.superuser ? "Superuser - everything" : `${d.grantedCount} of ${d.totalCount} permissions`,
          }),
          b.keyValue([
            { label: "Signed in as", value: String(d.user ?? "-") },
            { label: "Profiles", value: (d.profiles as string[])?.join(", ") || "none" },
          ]),
          rows.length
            ? b.table(
                [
                  { key: "category", label: "Area" },
                  { key: "capability", label: "You can" },
                  { key: "over", label: "Over" },
                ],
                rows,
              )
            : b.callout("No permissions granted - ask an admin to assign you a profile.", "warning"),
          b.callout(String(d.note ?? ""), "insight"),
        ],
        "Report the caller's own permissions and where they come from, rather than the catalogue in the abstract.",
      );
    }

    // "what should I do today" - the queue, not the diagnosis
    if (/(what should i|what do i|where do i start|my day|today|priorit(y|ies) today|work queue|next actions?)/.test(m)) {
      const d = await run("my_work_queue", {});
      if (!d) return done([b.callout("Couldn't build the work queue.", "warning")]);
      const items = (d.items ?? []) as Record<string, unknown>[];
      const by = (d.byReason ?? {}) as Record<string, number>;
      if (!items.length) {
        return done(
          [
            b.heading("Nothing is waiting on you", {}),
            b.callout(`All ${d.openLeads} open leads are triaged, in date and recently contacted.`, "success"),
          ],
          "Build the work queue; report an empty queue as a result rather than an error.",
        );
      }
      return done(
        [
          b.heading("Start here", { subtitle: `${d.total} of ${d.openLeads} open leads need a move` }),
          b.metrics([
            { label: "Late on us", value: String(by["late-on-us"] ?? 0), tone: "rose" },
            { label: "To chase", value: String(by["late-on-them"] ?? 0), tone: "amber" },
            { label: "Untriaged", value: String(by["untriaged"] ?? 0), tone: "violet" },
            { label: "Gone quiet", value: String(by["stale"] ?? 0) },
          ]),
          b.table(
            [
              { key: "name", label: "Lead" },
              { key: "reason", label: "Why" },
              { key: "priorityScore", label: "Priority", align: "right", kind: "number" },
              { key: "daysLate", label: "Days late", align: "right", kind: "number" },
              { key: "nextStep", label: "Next step" },
            ],
            items.map((i) => ({
              name: String(i.name ?? ""),
              reason: String(i.reason ?? ""),
              priorityScore: Number(i.priorityScore ?? 0),
              daysLate: Number(i.daysLate ?? 0),
              nextStep: String(i.nextStep ?? "-"),
            })),
          ),
          b.callout("Ordered by what is at stake, not by how late it is - a big deal two days late outranks a small one two weeks late.", "insight"),
        ],
        "Build one ranked queue of everything needing a move, ordered by stake rather than by date.",
      );
    }

    // who owes the next move / what am I late on
    if (/(late|overdue|owe|chase|waiting on|behind|to.?do|my work|triage|gone (quiet|cold)|stale)/.test(m)) {
      const side = /(chase|waiting on them|they owe|remind them)/.test(m)
        ? "them"
        : /(untriaged|no owner|nobody)/.test(m)
          ? "untriaged"
          : /(gone (quiet|cold)|stale)/.test(m)
            ? "stale"
            : /(i owe|we owe|on us|reply|respond|my work|to.?do)/.test(m)
              ? "us"
              : undefined;
      const d = await run("pipeline_health", side ? { side } : {});
      if (!d) return done([b.callout("Couldn't read pipeline health.", "warning")]);
      const leads = (d.leads ?? []) as Record<string, unknown>[];
      return done(
        [
          b.heading("Pipeline health", { subtitle: `${d.openLeads} open leads` }),
          b.metrics([
            { label: "Late on us", value: String(d.lateOnUs), tone: "rose" },
            { label: "Late on them", value: String(d.lateOnThem), tone: "amber" },
            { label: "Awaiting greenlight", value: `€${Number(d.awaitingGreenlightEur).toLocaleString()}`, tone: "cyan" },
            { label: "Needs an owner", value: String(d.untriaged) },
          ]),
          leads.length
            ? b.table(
                [
                  { key: "name", label: "Lead" },
                  { key: "waitingOn", label: "Owes" },
                  { key: "daysLate", label: "Days late", align: "right", kind: "number" },
                  { key: "nextStep", label: "Next step" },
                ],
                leads.map((l) => ({
                  name: String(l.name ?? ""),
                  waitingOn: l.waitingOn === "us" ? "us" : l.waitingOn === "them" ? "them" : "-",
                  daysLate: Number(l.daysLate ?? 0),
                  nextStep: String(l.nextStep ?? "-"),
                })),
              )
            : b.callout("Nothing is overdue on that filter.", "success"),
        ],
        "Read pipeline health, separate what we owe from what they owe, then list the overdue queue.",
      );
    }

    // money sitting with clients
    if (/(awaiting|greenlight|green light|sent.*(proposal|quote)|proposal.*(out|sent)|at risk|money.*(wait|out))/.test(m)) {
      const d = await run("money_at_risk", {});
      if (!d) return done([b.callout("Couldn't read the proposal queue.", "warning")]);
      const rows = (d.proposals ?? []) as Record<string, unknown>[];
      return done(
        [
          b.heading("Awaiting a greenlight", {
            subtitle: `${d.count} proposals - €${Number(d.totalEur).toLocaleString()}`,
          }),
          rows.length
            ? b.table(
                [
                  { key: "name", label: "Lead" },
                  { key: "valueEur", label: "Value", align: "right", kind: "currency" },
                  { key: "daysWaiting", label: "Waiting", align: "right", kind: "number" },
                  { key: "sentAt", label: "Sent" },
                ],
                rows.map((r) => ({
                  name: String(r.name ?? ""),
                  valueEur: Number(r.valueEur ?? 0),
                  daysWaiting: Number(r.daysWaiting ?? 0),
                  sentAt: String(r.sentAt ?? "-"),
                })),
              )
            : b.callout("Nothing is sitting with a client unanswered.", "success"),
        ],
        "Pull the queue of sent proposals with no answer, oldest first.",
      );
    }

    // high priority / top leads. "Hot" stays in the pattern because people who
    // used the old spreadsheet still ask for it - understanding the word costs
    // nothing, and the label it maps to is today's.
    if (/(hot lead|high priorit|top lead|best lead|priorit|who should i (call|contact|chase)|top \d+)/.test(m)) {
      const wantsHigh = /\bhot\b|high priorit/.test(m);
      const d = (await run("search_leads", { ...(wantsHigh ? { priority: "High" } : {}), sortBy: "priority", limit: 6 })) as
        | { count: number; leads: Record<string, unknown>[] }
        | undefined;
      const leads = d?.leads ?? [];
      if (leads.length === 0) return done([b.callout("No leads match that yet.", "warning")]);
      return done(
        [
          b.heading(wantsHigh ? "Top high-priority leads" : "Highest-scoring leads", { subtitle: `${leads.length} shown` }),
          b.leadGrid(leads.map(toLeadCard)),
        ],
        wantsHigh ? "Filter to High priority, sort by priority score, render as lead cards." : "Sort all leads by priority score, render the top as cards.",
      );
    }

    // pipeline summary
    if (/(pipeline|summary|overview|how many|weighted|closed|total leads|state of|how'?s|health)/.test(m)) {
      const d = (await run("pipeline_summary")) as
        | { totalLeads: number; scored: number; highPriorityLeads: number; dealsClosed: number; weightedValueEur: number; byStatus: Record<string, number> }
        | undefined;
      if (!d) return done([b.callout("Couldn't read the pipeline.", "danger")]);
      const palette = ["brand", "cyan", "mint", "amber", "rose", "violet", "neutral"] as const;
      return done(
        [
          b.heading("Pipeline overview", { subtitle: `Snapshot of ${d.totalLeads} leads` }),
          b.metrics([
            { label: "Total leads", value: d.totalLeads, tone: "brand" },
            { label: "Scored", value: d.scored, tone: "cyan" },
            { label: "High priority", value: d.highPriorityLeads, tone: "rose" },
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

    // fallback - lead lookup or search
    const lead = await this.resolveLead(message, opts.history ?? []);
    if (lead) {
      const d = (await run("get_lead", { id: lead.id })) as Record<string, unknown> | undefined;
      if (d?.found) {
        return done([
          b.heading(lead.name, {}),
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
      return done([b.heading("Matches", { subtitle: `${sd.count} found` }), b.leadGrid(sd.leads.map(toLeadCard))]);
    }
    return done([
      b.heading("BD Copilot", {}),
      b.list(
        [
          "“Summarise the pipeline” - KPIs + stage donut",
          "“Top high-priority leads to call this week” - ranked lead cards",
          "“Why is Alibaba scored that way?” - score breakdown chart",
          "“Where's our biggest untapped market?” - whitespace analysis",
          "“Draft an intro to Generali” - queued outreach",
        ],
        "check",
      ),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Foundry provider - structured-output blocks via an OpenAI-compatible model,
// ---------------------------------------------------------------------------
// Reasoning effort
//
// One model, always: COPILOT_MODEL (gpt-5.4-mini). "Think deeply" does not
// swap models - it raises reasoning_effort on the same deployment, which is
// all that switch ever meant.
// ---------------------------------------------------------------------------

/** Documented values; anything else is a typo we should not forward. */
const EFFORT_VALUES = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof EFFORT_VALUES)[number];

/**
 * Effort for an ordinary ask. Deliberately `low` rather than `minimal`:
 * minimal disables parallel tool calls, and this copilot is a tool-calling
 * loop, so it would quietly make every answer slower and worse.
 */
export const EFFORT_NORMAL: ReasoningEffort = "low";

/** Effort when the user turns "Think deeply" on. */
export function deepEffort(): ReasoningEffort {
  const raw = process.env.COPILOT_REASONING_EFFORT?.trim().toLowerCase();
  return (EFFORT_VALUES as readonly string[]).includes(raw ?? "") ? (raw as ReasoningEffort) : "high";
}

export function effortFor(deep: boolean | undefined): ReasoningEffort {
  return deep ? deepEffort() : EFFORT_NORMAL;
}

/**
 * Ceiling for one reply, reasoning included.
 *
 * Reasoning tokens are billed against the same budget as the visible answer, so
 * leaving this unset let a deep answer spend the deployment's default thinking
 * and return a stub. Generous by design - it is a cap, not a reservation, and
 * the model stops when it has finished.
 */
export function completionBudget(): number {
  const raw = Number(process.env.COPILOT_MAX_COMPLETION_TOKENS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 16_000;
}

export const copilotModel = () => process.env.COPILOT_MODEL ?? "gpt-5.4-mini";

/**
 * Who is asking, as a system message.
 *
 * Leads carry an `owner` name, so without this "my pipeline", "what do I owe"
 * and "leads under my name" have nothing to resolve against - the model was
 * being asked personal questions with no idea whose they were.
 */
export function callerContext(user: SessionUser): string {
  return [
    `The person you are talking to is ${user.name} (${user.email}).`,
    `Address them by first name when it reads naturally.`,
    `Lead ownership is recorded as a plain name, and theirs is "${user.name}" - so "my leads", "my pipeline", "what do I owe" and similar mean leads whose owner matches that. Pass it as the owner argument to the tools that take one, rather than asking them who they are.`,
    `Never claim a lead is theirs unless the owner actually matches; say whose it is instead.`,
    `If they ask what they may do, use what_can_i_do rather than guessing from their role.`,
  ].join(" ");
}

// ---------------------------------------------------------------------------
// with a function-calling loop. Activates when COPILOT_CHAT_ENDPOINT is set
// (keyless via managed identity, or COPILOT_API_KEY). Wired for deploy.
// ---------------------------------------------------------------------------

/**
 * A model call that could not be completed, in words a person can act on.
 *
 * "Foundry model call failed: 429" is a status code shown to somebody who
 * asked a question about their pipeline. Throttling is the common case and it
 * is temporary, so it has to say so and say what to do.
 */
export class CopilotUnavailableError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(
      status === 429
        ? "The model is busy right now - it is rate limited. Give it a few seconds and ask again."
        : status === 401 || status === 403
          ? "I could not authenticate to the model. That is a deployment setting, not something you can fix from here."
          : `The model did not answer (HTTP ${status}). Try again in a moment.`,
    );
    this.name = "CopilotUnavailableError";
    this.status = status;
  }
}

class FoundryCopilotProvider implements CopilotProvider {
  readonly name = "foundry";

  /**
   * Flipped off for the process if the deployment rejects reasoning_effort.
   * Some models (gpt-5-chat) answer "Unrecognized request argument" - and since
   * the parameter now rides on EVERY call, not just deep ones, treating that as
   * fatal would take the whole copilot down rather than one toggle.
   */
  private static effortSupported = true;

  /** Same story for the completion budget: older deployments want max_tokens. */
  private static tokenParam: "max_completion_tokens" | "max_tokens" | null = "max_completion_tokens";

  private async authHeader(): Promise<Record<string, string>> {
    if (process.env.COPILOT_API_KEY) return { "api-key": process.env.COPILOT_API_KEY };
    const { DefaultAzureCredential } = await import("@azure/identity");
    const token = await new DefaultAzureCredential().getToken("https://cognitiveservices.azure.com/.default");
    return { Authorization: `Bearer ${token?.token ?? ""}` };
  }

  /**
   * Retry a throttled or briefly unavailable deployment.
   *
   * One turn is several calls - the tool loop sends the whole tool surface each
   * time - so a busy minute lands on 429 easily, and a 429 is a "wait", not a
   * failure. Without this the second question in a conversation died and the
   * user saw an HTTP status code.
   *
   * Retry-After is honoured when the service sends one, because it knows when
   * the window reopens and a guess does not.
   */
  private async sendWithBackoff(
    send: (payload: Record<string, unknown>) => Promise<Response>,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const RETRYABLE = new Set([429, 500, 502, 503, 504]);
    let wait = 1_000;
    let res = await send(body);

    for (let attempt = 0; attempt < 3 && RETRYABLE.has(res.status); attempt++) {
      const after = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 20_000) : wait;
      const { setTimeout: delayFor } = await import("node:timers/promises");
      await delayFor(delay, undefined, { signal });
      wait = Math.min(wait * 2, 8_000);
      res = await send(body);
    }
    return res;
  }

  private async post(endpoint: string, headers: Record<string, string>, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const send = (payload: Record<string, unknown>) =>
      fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload), signal });

    let res = await this.sendWithBackoff(send, body, signal);
    if (res.ok || res.status !== 400) return res;

    // Only retry for the arguments a deployment can legitimately reject, so a
    // genuine 400 still surfaces.
    const detail = await res.clone().text();

    if ("reasoning_effort" in body && /reasoning_effort/i.test(detail)) {
      FoundryCopilotProvider.effortSupported = false;
      const { reasoning_effort: _dropped, ...rest } = body;
      res = await send(rest);
      if (res.ok || res.status !== 400) return res;
      body = rest;
    }

    // max_completion_tokens is the reasoning-model spelling; older deployments
    // only know max_tokens, and some reject both.
    if ("max_completion_tokens" in body && /max_completion_tokens/i.test(detail)) {
      const { max_completion_tokens: budget, ...rest } = body;
      FoundryCopilotProvider.tokenParam = "max_tokens";
      res = await send({ ...rest, max_tokens: budget });
      if (res.ok) return res;
      FoundryCopilotProvider.tokenParam = null;
      return send(rest);
    }

    return res;
  }

  async ask(message: string, user: SessionUser, opts: AskOptions = {}): Promise<CopilotTurn> {
    const endpoint = process.env.COPILOT_CHAT_ENDPOINT!;
    const model = copilotModel();
    const headers = { "content-type": "application/json", ...(await this.authHeader()) };
    const messages: Record<string, unknown>[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: callerContext(user) },
      ...(opts.history ?? []).map((t) => ({ role: t.role, content: t.content })),
      { role: "user", content: message },
    ];
    const runs: ToolRun[] = [];
    let retriedComposition = false;

    for (let step = 0; step < 6; step++) {
      opts.signal?.throwIfAborted();
      const body: Record<string, unknown> = {
        model,
        messages,
        tools: toolSchemas(),
        tool_choice: "auto",
        response_format: { type: "json_schema", json_schema: blocksResponseSchema() },
      };
      if (FoundryCopilotProvider.effortSupported) body.reasoning_effort = effortFor(opts.reasoning);
      // Reasoning tokens are spent from this same budget, so leaving it at the
      // deployment default let a deep answer think its way to a stub.
      if (FoundryCopilotProvider.tokenParam) body[FoundryCopilotProvider.tokenParam] = completionBudget();

      const res = await this.post(endpoint, headers, body, opts.signal);
      if (!res.ok) throw new CopilotUnavailableError(res.status);
      const json = (await res.json()) as { choices: { message: Record<string, unknown> }[] };
      const msg = json.choices[0]?.message ?? {};
      messages.push(msg);

      const toolCalls = (msg.tool_calls as { id: string; function: { name: string; arguments: string } }[]) ?? [];
      if (toolCalls.length === 0) {
        const raw = String(msg.content ?? "");
        const decoded = safeJson(raw);
        const blocks = parseBlocks(decoded);
        if (blocks.length) return { blocks, toolRuns: runs, provider: this.name,
          needsInput: !!decoded && typeof decoded === "object" && "needsInput" in decoded && decoded.needsInput === true };

        // Nothing valid came back. If the content is JSON at all it is not an
        // answer - under a json_schema response format the usual failure is
        // the model echoing the SCHEMA back, and a wall of
        // {"type":"object","properties":... in a chat window is worse than
        // saying nothing. Ask once more; a schema echo is not deterministic.
        if (isStructuredNotProse(raw)) {
          if (!retriedComposition) {
            retriedComposition = true;
            messages.push({
              role: "system",
              content:
                "That reply was not a valid blocks object - it looked like the schema rather than an answer. Reply again with the ANSWER itself, as an instance of the schema.",
            });
            continue;
          }
          return {
            blocks: [b.text("I couldn't compose that answer. Ask me again, or rephrase it slightly.")],
            toolRuns: runs,
            provider: this.name,
          };
        }
        return { blocks: [b.text(raw)], toolRuns: runs, provider: this.name };
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
        if (r.data && typeof r.data === "object" && "pending" in r.data && r.data.pending === true) {
          return { blocks: [b.text("Review the proposed change before confirming it.")], toolRuns: runs, provider: this.name, needsInput: true };
        }
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

/**
 * Is this reply a data structure rather than something written for a person?
 *
 * Only asked once a reply has already failed block validation. Prose is not
 * JSON, so anything that parses is a machine artefact - in practice the schema
 * echoed back - and must never be printed into a chat window.
 */
export function isStructuredNotProse(raw: string): boolean {
  const t = raw.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return false;
  return safeJson(t) !== null;
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
