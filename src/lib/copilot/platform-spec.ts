import "server-only";
import { PERMISSIONS, type PermissionDef } from "@/lib/auth/catalogue";
import { SYSTEM_PROFILES } from "@/lib/auth/profiles";
import { BRAND_STATUSES, PRIORITIES, INDUSTRIES } from "@/lib/vocab";
import { STATUS_FLOW, ENTRY_STATUSES } from "@/lib/workflow";

/**
 * What the platform is and how to work it, for the copilot.
 *
 * The tool catalogue and the permission catalogue are passed in or read from
 * their registries rather than written out here, so the copilot's account of
 * what it can do cannot drift from what it can actually do - the failure mode
 * of describing any of this in prose.
 *
 * Takes the tools as an argument instead of importing them: tools.ts already
 * imports tools-extra.ts, and reaching back the other way would close a cycle.
 */
export interface ToolSummary {
  name: string;
  description: string;
  permission?: string;
  write?: boolean;
}

export function platformSpec(tools: ToolSummary[]) {
  return {
    what: "OOVIE BD Intelligence - the team's 'Business Development / Client Segmentation' workbook rebuilt as a live, scored, permissioned workspace. Six spreadsheet tabs became a pipeline you can edit, a scoring model you can interrogate, a client view that adds up repeat business, and a chat that can do all of it for you.",

    dataModel: {
      lead: "One engagement, and the row the sheet used to hold. Carries a name, stage, priority label, industry, owner, point of contact, contact dates, follow-up, who owes the next move, expected duration, notes, strategic value and a commercial value with a confidence.",
      company: "The client relationship. Projected from its deals on every read, so it can never fall out of step with an edit. Rolls up lifetime value, repeat value beyond the first win, open pipeline and a deal win rate.",
      deal: "A lead, seen from the company's side. Same record, one engagement.",
      proposal: "A commercial document with its own value, revision and status. A re-quote adds a revision rather than overwriting, so the history survives.",
      outreach: "An email drafted against a lead. Drafted, optionally awaiting approval, then sent or cancelled.",
      relationship: "company → many deals → many proposals. One lead IS one deal, which is why a client with three engagements shows one company and three deals, not three clients.",
      vocabularies: { stages: BRAND_STATUSES, priorities: PRIORITIES, industries: INDUSTRIES },
      stageFlow: {
        entryPoints: ENTRY_STATUSES,
        allowed: STATUS_FLOW,
        note: "Stage moves are restricted to this graph so the pipeline cannot jump illegally. The edit dialog can set a stage directly; the quick-advance buttons and advance_lead_stage enforce the graph.",
      },
    },

    sections: [
      { route: "/dashboard", name: "Overview", shows: "Headline counts, the probability-weighted value of the LIVE book, the stage funnel, the priority quadrant and the industry scorecard." },
      { route: "/dashboard/pipeline", name: "Pipeline", permission: "lead:read", shows: "The full editable lead list, led by five headlines: pipeline value, outstanding proposals, To reply, To follow up, and leads nobody owns.", actions: "Search by brand/POC/notes - filter by Show (Active default, Won, Lost, Everything), health, status and owner - sort any column - save named views - export CSV/JSON/Excel/PDF - add or edit a lead." },
      { route: "/dashboard/pipeline/{id}", name: "Lead detail", permission: "lead:read", shows: "Priority, quadrant, value and expected value; next move and pace; the company card; the score breakdown; proposals; activity; outreach history.", actions: "Edit every field - quick stage transitions - record a proposal - link or unlink a company - compose outreach - delete (needs lead:delete)." },
      { route: "/dashboard/companies", name: "Companies", permission: "lead:read", shows: "Every client with open pipeline, lifetime and repeat value; where each money figure comes from; a possible-duplicates card.", actions: "Search - sort - merge two companies (needs company:merge)." },
      { route: "/dashboard/companies/{id}", name: "Company detail", permission: "lead:read", shows: "Rollup metrics, every deal with the basis of its value, every proposal.", actions: "Start a new deal under this client - add or edit proposals (needs proposal:manage)." },
      { route: "/dashboard/scoring", name: "Scoring", permission: "scoring:read", shows: "The quadrant, the ranked list, and the model written out in full - every weight, both thresholds, the grade bands, what has no effect, and when it recalculates.", actions: "Export the scored table." },
      { route: "/dashboard/industries", name: "Industries", permission: "industry:read", shows: "Per-segment scorecard fused with the sales playbook. Counted from the live pipeline; market size stays as imported research." },
      { route: "/dashboard/whitespace", name: "Whitespace & TAM", permission: "tam:read", shows: "Approached versus addressable EU market, an opportunity map and market sizing." },
      { route: "/dashboard/quality", name: "Data quality", permission: "quality:read", shows: "The import audit trail plus live checks; rows whose imported outcome contradicts their stage.", actions: "Confirm the stage is right to close a conflict (needs lead:update)." },
      { route: "/dashboard/copilot", name: "Copilot", permission: "copilot:use", shows: "Chat answering in live blocks - charts, tables, lead cards, score breakdowns.", actions: "Ask - attach documents - voice - Think deeply - New chat and resumable history." },
      { route: "/dashboard/reminders", name: "Reminders", permission: "reminder:read", shows: "Follow-ups due, overdue and upcoming, closed leads excluded.", actions: "Complete or snooze." },
      { route: "/dashboard/outbox", name: "Outbox", permission: "outreach:read", shows: "Every drafted, pending, sent and cancelled message.", actions: "Send (needs outreach:send) - cancel." },
      { route: "/dashboard/activity", name: "Activity", permission: "audit:read", shows: "The append-only audit trail of every change, who made it and when." },
      { route: "/dashboard/agents", name: "Agents & agencies", permission: "agent:read", shows: "The AgentsAgencies tab - intermediaries and their status." },
      { route: "/dashboard/team", name: "Team & access", permission: "user:read", shows: "Members, their profiles and effective permissions.", actions: "Create users, assign profiles, grant or deny individual permissions." },
    ],

    howDoI: {
      "add a lead": "Pipeline → “+ New lead”. Only the name is required, but give it a commercial value - a lead with no value cannot be ranked at all, because zero opportunity is fatal in the priority formula. Or ask the copilot: it uses create_lead.",
      "add a second deal for a client we already have": "Open the company → Deals → “New deal”. It links the new lead to that client, so their history adds up instead of becoming a second company.",
      "edit a lead": "Pipeline → the row's “Edit” button, or the Edit button on the lead page. The dialog holds every field including the commercial value and the four 0-5 judgements behind the score.",
      "delete a lead": "The edit dialog, at the bottom: “Remove this lead”, behind a confirm. Permanent, and it takes the lead's proposals and outreach with it. Needs lead:delete - without it the dialog says to ask an admin.",
      "change a lead's stage": "The quick-advance buttons on the lead page follow the legal transitions. The edit dialog can set any stage directly.",
      "record a proposal": "Lead page or company page → “New proposal”. Value, status and dates. Each call adds a revision, so a re-quote keeps the history.",
      "make a budget official": "Record the proposal as accepted. That writes the figure onto the lead as Confirmed and keeps the original estimate for the variance report.",
      "merge two companies that are the same client": "Companies → the merge control at the bottom: pick the one to fold in and the one that survives. Every deal moves; the source stops existing because companies are projected from their deals. Undo is unlinking a deal from its lead page. Needs company:merge.",
      "find a client": "Companies has its own search box. The pipeline search covers brand, POC and notes - and if what you want is a finished deal, it offers to show it rather than coming up empty.",
      "see only live deals": "The pipeline opens on Show: Active. Won, Lost and Everything sit beside it with their counts.",
      "know why a lead ranks where it does": "The lead page's score breakdown, or the scoring page's full reference. Or ask the copilot - explain_model returns the exact weights and a worked example on that lead.",
      "export": "The Export menu on the pipeline, scoring, industries and quality pages. CSV, JSON, Excel (.xlsx) or PDF, respecting the filters you have set.",
      "save a filter combination": "Pipeline → Views → save the current search, filters and sort under a name.",
      "send an email": "Lead page → compose outreach. It is saved as a draft; sending is a separate, permission-gated step from the Outbox or the lead. Members raise a pending-approval request an admin sends.",
      "change what someone can do": "Team & access → the member → assign a profile, or grant and deny individual permissions on top.",
      "recover an account": "The login page links to “Forgot password”. A reset link is emailed; one-time login codes are available when enabled.",
      "replay this tour": "The “?” launcher in the top bar, or ⌘K → replay the tour.",
      "jump anywhere fast": "⌘K (Ctrl-K) opens the command palette: search a lead, jump to a section, or run a quick action.",
    },

    permissions: {
      model: "Permissions are grouped into profiles assigned to people, with optional per-user grants and denies on top. Deny always wins. Most permissions are SCOPED: none / own / team / all - so 'edit leads: own' means you may change only the leads you own, and the record check runs against the scope the WRITE permission resolved to, not the read one.",
      profiles: SYSTEM_PROFILES.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        superuser: p.superuser === true,
      })),
      catalogue: (PERMISSIONS as readonly PermissionDef[]).map((p) => ({
        key: p.key,
        label: p.label,
        category: p.category,
        scoped: p.scoped,
        risk: p.risk ?? null,
        help: p.help ?? null,
      })),
      note: "To answer what a SPECIFIC person may do, call what_can_i_do rather than reasoning from their role - a profile can be adjusted per user.",
    },

    copilot: {
      identity: "The copilot acts as the signed-in user. Every tool declares the permission it needs and it is checked centrally before the tool runs, so the chat can do exactly what that person could do on the screens - never more.",
      recordScope: "Anything taking a lead id re-resolves it through the same visibility rules the pages use. A lead out of scope answers 'not found', which is also what a lead that does not exist answers, so a reply never confirms a record the caller cannot open.",
      audit: "Every write is logged as that person, marked '(via copilot)'.",
      irreversible: "Deleting a lead, merging companies and sending outreach arrive as a button the user presses, with a confirm naming what will happen. They are never fired straight from a sentence.",
      intake: "A half-finished request is finished before it is acted on. check_request compares what has been gathered against what the record actually needs, and returns the missing questions with the cost of leaving each one blank; they are asked together in one message, never drip-fed. Saying it is fine as it stands ends the questions immediately. Asking what to put triggers suggest_lead_fields, which reasons from comparable deals - the median value for that segment with its quartiles, who owns the live deals there, how long finished ones really took - and hands anything the pipeline cannot know to web_search. Nothing is ever invented to fill a blank.",
      answering: "Answers are composed as typed UI blocks - headings, metrics, charts, tables, lead cards, score breakdowns, callouts, actions - not plain prose.",
      toolCount: tools.length,
      writeToolCount: tools.filter((t) => t.write).length,
      tools: tools.map((t) => ({
        name: t.name,
        does: t.description,
        needs: t.permission ?? null,
        writes: t.write === true,
      })),
    },

    accounts: {
      signIn: "Email and password. The first account created becomes an admin.",
      recovery: "Password reset by emailed link; one-time login codes when enabled for the deployment.",
      sessions: "JWT sessions; signing out returns to the public site.",
    },
  };
}
