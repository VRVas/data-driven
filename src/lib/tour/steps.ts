// Interactive product tour — an end-to-end guided walkthrough of every surface
// in the app, cross-referenced to the source "Business Development – Client
// Segmentation" workbook (6 tabs: Brands Operative, Brand Data, Brand Analysis,
// Sales Strategy, AgentsAgencies, Agency Data).
//
// Each step optionally spotlights a `[data-tour="…"]` anchor on a given route.
// Steps with no `selector` render a centered card. `optional` steps are skipped
// silently when their anchor is absent (e.g. admin-only controls for members).

export type TourPlacement = "top" | "bottom" | "left" | "right" | "center";

export interface TourStep {
  id: string;
  route: string;
  selector?: string;
  title: string;
  body: string;
  /** How this maps back to the source sheet. */
  sheet?: string;
  placement?: TourPlacement;
  optional?: boolean;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    route: "/dashboard",
    title: "Welcome to BD Intelligence",
    body: "This is your Client Segmentation sheet, turned into a live, scored, searchable workspace. Let's walk through everything — it takes about a minute.",
    sheet: "Everything here is built from the 6 tabs of the workbook.",
    placement: "center",
  },
  {
    id: "nav",
    route: "/dashboard",
    selector: '[data-tour="nav"]',
    title: "Your command bar",
    body: "Jump between Overview, Pipeline, Agents, Scoring, Industries, Whitespace, Data Quality and the Copilot. The active section stays lit.",
    placement: "bottom",
  },
  {
    id: "overview-kpis",
    route: "/dashboard",
    selector: '[data-tour="kpis"]',
    title: "Headline metrics",
    body: "Four numbers at a glance: total pipeline, probability-weighted value, deals closed, and how much of the pipeline is scored.",
    sheet: "Rolled up from Brands Operative (status) + Brand Data (scores).",
    placement: "bottom",
  },
  {
    id: "overview-funnel",
    route: "/dashboard",
    selector: '[data-tour="funnel"]',
    title: "Pipeline by stage",
    body: "See how leads are distributed across the sales funnel, from first contact to closed.",
    sheet: "Mirrors the Status column in Brands Operative (Deal Closed, Advanced, Follow Up, Early, Back to Attack, Recurring, Still to open, Did not work out).",
    placement: "right",
  },
  {
    id: "overview-quadrant",
    route: "/dashboard",
    selector: '[data-tour="quadrant"]',
    title: "Priority quadrant",
    body: "Every scored lead plotted by economical efficiency (Y) against ease of access (X); bubble size is the deal budget. Top-right = go after it now.",
    sheet: "Straight from the Brand Data scoring model.",
    placement: "left",
  },
  {
    id: "overview-heatmap",
    route: "/dashboard",
    selector: '[data-tour="heatmap"]',
    title: "Industry scorecard",
    body: "A segment-level view of how attractive each industry is, recomputed from the underlying data.",
    sheet: "Derived from the Brand Analysis tab.",
    placement: "top",
  },
  {
    id: "pipeline",
    route: "/dashboard/pipeline",
    selector: '[data-tour="nav"]',
    title: "Pipeline — the lead tracker",
    body: "The heart of the app: your full, editable lead list. This is the Brands Operative tab, live.",
    sheet: "Brands Operative: name, status, priority, owner, POC, industry, contact dates, follow-up, notes.",
    placement: "bottom",
  },
  {
    id: "pipe-search",
    route: "/dashboard/pipeline",
    selector: '[data-tour="pipe-search"]',
    title: "Search & filter",
    body: "Find anything fast — search by brand, POC or notes, then narrow by status and owner.",
    placement: "bottom",
  },
  {
    id: "pipe-newlead",
    route: "/dashboard/pipeline",
    selector: '[data-tour="pipe-newlead"]',
    title: "Add a lead",
    body: "Create a new lead here. The editor captures every field from the sheet — status, priority, owner, POC, industry, budget, contact dates and notes.",
    sheet: "One row of Brands Operative = one lead.",
    placement: "bottom",
  },
  {
    id: "pipe-export",
    route: "/dashboard/pipeline",
    selector: '[data-tour="pipe-export"]',
    title: "Export the view",
    body: "Download exactly what you're looking at (respecting filters) as CSV or JSON — handy for sharing or reconciling with the sheet.",
    placement: "bottom",
  },
  {
    id: "pipe-views",
    route: "/dashboard/pipeline",
    selector: '[data-tour="pipe-views"]',
    title: "Saved views",
    body: "Save a search + filter + sort combination as a named view (e.g. \"My hot leads\") and jump back to it in one click.",
    placement: "bottom",
  },
  {
    id: "pipe-edit",
    route: "/dashboard/pipeline",
    selector: '[data-tour="pipe-edit"]',
    title: "Edit & open a lead",
    body: "Edit any row inline, or click a brand name to open its detail page with the full scoring breakdown and activity.",
    placement: "left",
    optional: true,
  },
  {
    id: "agents",
    route: "/dashboard/agents",
    selector: '[data-tour="nav"]',
    title: "Agents & agencies",
    body: "The same tracker, for your agency and talent partners — who you're working with, at what stage.",
    sheet: "AgentsAgencies (pipeline) + Agency Data (their scoring).",
    placement: "bottom",
  },
  {
    id: "scoring",
    route: "/dashboard/scoring",
    selector: '[data-tour="nav"]',
    title: "Scoring model",
    body: "The transparent, weighted model behind every lead's rank. Adjust your mental model of what a good lead looks like.",
    sheet: "Brand Data: tempo, closing likelihood, budget, customization, accessibility and receptivity → one weighted score.",
    placement: "bottom",
  },
  {
    id: "industries",
    route: "/dashboard/industries",
    selector: '[data-tour="nav"]',
    title: "Industries & playbook",
    body: "Segment analysis plus the go-to-market playbook: what each industry needs and how to pitch it.",
    sheet: "Brand Analysis (segment metrics) + Sales Strategy (marketing & product needs per industry type).",
    placement: "bottom",
  },
  {
    id: "whitespace",
    route: "/dashboard/whitespace",
    selector: '[data-tour="nav"]',
    title: "Whitespace & TAM",
    body: "Where the untapped opportunity is: market penetration vs. total addressable market, so you know where to expand.",
    sheet: "Modelled from industry sizing in the workbook.",
    placement: "bottom",
  },
  {
    id: "quality",
    route: "/dashboard/quality",
    selector: '[data-tour="nav"]',
    title: "Data quality",
    body: "Keeps the pipeline clean — flags missing fields, unscored leads and stale contacts so nothing slips through.",
    sheet: "Continuous checks against the Brands Operative / Brand Data structure.",
    placement: "bottom",
  },
  {
    id: "copilot",
    route: "/dashboard/copilot",
    selector: '[data-tour="nav"]',
    title: "Meet the Copilot",
    body: "Chat with your pipeline in plain language. It answers with live charts, tables and cards — grounded in your real data, acting as you.",
    placement: "bottom",
  },
  {
    id: "copilot-suggestions",
    route: "/dashboard/copilot",
    selector: '[data-tour="copilot-suggestions"]',
    title: "Ask anything",
    body: "Start with a suggestion or ask your own: “Summarise the pipeline”, “Why is Alibaba scored that way?”, “Top opportunities in Finance”, “What follow-ups are due?”.",
    placement: "right",
    optional: true,
  },
  {
    id: "copilot-reasoning",
    route: "/dashboard/copilot",
    selector: '[data-tour="copilot-reasoning"]',
    title: "Deep reasoning",
    body: "Toggle “Think deeply” for tougher questions — the Copilot routes to a reasoning model and shows its step-by-step thinking.",
    placement: "top",
  },
  {
    id: "copilot-input",
    route: "/dashboard/copilot",
    selector: '[data-tour="copilot-input"]',
    title: "It can act, too",
    body: "Beyond answering, the Copilot can search leads, explain scores, list reminders — and even draft outreach or advance a stage. Writes are logged and outreach needs admin approval.",
    placement: "top",
  },
  {
    id: "reminders",
    route: "/dashboard",
    selector: '[data-tour="topbar-reminders"]',
    title: "Follow-up reminders",
    body: "Never miss a touch. The bell counts what's due today; this inbox lists everything with snooze and done.",
    sheet: "Driven by the Follow Up date column in Brands Operative.",
    placement: "left",
    optional: true,
  },
  {
    id: "outbox",
    route: "/dashboard",
    selector: '[data-tour="topbar-outbox"]',
    title: "Outreach outbox",
    body: "Drafted emails collect here. Members draft; admins review, approve and send — so nothing goes out unchecked.",
    placement: "left",
    optional: true,
  },
  {
    id: "activity",
    route: "/dashboard",
    selector: '[data-tour="topbar-activity"]',
    title: "Activity — audit trail",
    body: "Every change to the pipeline is logged here: who did what, when. (Admins only.)",
    placement: "left",
    optional: true,
  },
  {
    id: "team",
    route: "/dashboard",
    selector: '[data-tour="topbar-team"]',
    title: "Team & roles",
    body: "Manage who's an admin (can approve outreach, delete leads, see the audit trail) versus a member. (Admins only.)",
    placement: "left",
    optional: true,
  },
  {
    id: "finish",
    route: "/dashboard",
    title: "You're all set",
    body: "That's the whole app. Replay this tour anytime from the “?” button in the top bar. Now go close some deals.",
    placement: "center",
  },
];
