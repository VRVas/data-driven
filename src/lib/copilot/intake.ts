/**
 * What a COMPLETE request looks like, per write tool.
 *
 * A JSON Schema says what the code needs to not crash. It does not say what
 * the record needs to be worth having: create_lead validates with nothing but
 * a name, and produces a lead that cannot be ranked, cannot be chased and
 * belongs to nobody. The gap between those two is the thing a good colleague
 * asks about before submitting, and it is written down here rather than in the
 * prompt so it can be tested and can never quietly disagree with the tools.
 *
 * Three levels, and the difference matters:
 *   required  - the call fails without it.
 *   important - the call succeeds and the record is broken in a nameable way.
 *   useful    - the record is thinner, and somebody will wish it were there.
 *
 * Pure on purpose: no store, no session, no `server-only`. It answers "what
 * does this need" for anyone who asks.
 */

export type IntakeNeed = "required" | "important" | "useful";

export interface IntakeField {
  field: string;
  label: string;
  need: IntakeNeed;
  /** What it costs to leave this out, in the user's terms, not the schema's. */
  why: string;
  /** The question, phrased so it can be put to the user as written. */
  ask: string;
}

export interface IntakeSpec {
  tool: string;
  /** What a finished record of this kind is for. */
  purpose: string;
  fields: readonly IntakeField[];
}

export interface IntakeCheck {
  tool: string;
  purpose: string;
  /** Nothing required is missing - the call would go through. */
  ready: boolean;
  /** Nothing at all is missing. */
  complete: boolean;
  provided: string[];
  missingRequired: IntakeField[];
  missingImportant: IntakeField[];
  missingUseful: IntakeField[];
  /** Every outstanding question, strongest need first, to be asked in one go. */
  questions: string[];
  /** What proceeding as-is would cost - empty when nothing is lost. */
  consequences: string[];
  guidance: string;
}

export const INTAKE_SPECS: readonly IntakeSpec[] = [
  {
    tool: "create_lead",
    purpose: "A lead that can be ranked, chased and reported on from the moment it exists.",
    fields: [
      {
        field: "name",
        label: "Brand name",
        need: "required",
        why: "There is nothing to create without one.",
        ask: "What is the brand called?",
      },
      {
        field: "valueEur",
        label: "Commercial value",
        need: "important",
        why: "Priority is the geometric mean of opportunity and winnability, so a deal worth nothing scores zero however winnable it is. With no value the lead cannot be ranked at all and is absent from the pipeline total.",
        ask: "Roughly what do you expect it to be worth, in euros? A guess is fine - it is stored as Estimated and a proposal can confirm it later.",
      },
      {
        field: "owner",
        label: "Owner",
        need: "important",
        why: "An unowned lead counts towards the 'nobody owns this' headline, and under record scope it can be invisible to the very people who could work it.",
        ask: "Who owns it?",
      },
      {
        field: "status",
        label: "Stage",
        need: "important",
        why: "The stage carries the win probability that drives the winnability axis, the weighted pipeline value and the funnel. Left unset it is treated as not yet opened.",
        ask: "What stage is it at - still to open, early, follow up, or advanced?",
      },
      {
        field: "industry",
        label: "Industry",
        need: "important",
        why: "Industry is what the segment scorecard, the whitespace map and the playbook advice group by. Without it the lead is missing from all three.",
        ask: "Which industry does it belong to?",
      },
      {
        field: "poc",
        label: "Point of contact",
        need: "useful",
        why: "Outreach has nobody to address, and the contact is what half of all searches look for.",
        ask: "Who is the contact there?",
      },
      {
        field: "email",
        label: "Contact email",
        need: "useful",
        why: "Nothing can be sent to the lead without an address, so draft_outreach will refuse.",
        ask: "What is their email address?",
      },
      {
        field: "priority",
        label: "Priority label",
        need: "useful",
        why: "High, medium or low is the human read that sits beside the computed score. The two disagreeing is itself a useful signal.",
        ask: "High, medium or low?",
      },
      {
        field: "nextStep",
        label: "Next step",
        need: "useful",
        why: "Without it the lead joins the untriaged pile: nothing in the record says what happens next or who owes it.",
        ask: "What is the next step?",
      },
      {
        field: "notes",
        label: "Notes",
        need: "useful",
        why: "Context is what the rest of the team reads before they call. Notes are carried into reminder emails and every export.",
        ask: "Anything worth noting - how it came in, what was said, what to be careful of?",
      },
    ],
  },
  {
    tool: "record_proposal",
    purpose: "The paperwork of record: what was quoted, and what happened to it.",
    fields: [
      {
        field: "leadId",
        label: "Lead",
        need: "required",
        why: "A proposal belongs to one deal.",
        ask: "Which lead is the proposal for?",
      },
      {
        field: "valueEur",
        label: "Proposal value",
        need: "required",
        why: "The lead's value follows the paperwork, so the figure is the point of recording it.",
        ask: "What value was quoted, in euros?",
      },
      {
        field: "status",
        label: "Status",
        need: "required",
        why: "Whether it is drafted, sent or accepted decides whether it counts as money outstanding, and an acceptance confirms the lead's budget rather than estimating it.",
        ask: "Is it drafted, sent, accepted, rejected, expired or withdrawn?",
      },
      {
        field: "sentAt",
        label: "Date sent",
        need: "important",
        why: "The age of a sent proposal is what the money-at-risk queue sorts by. Without a date it cannot be told apart from one sent this morning.",
        ask: "When was it sent? (YYYY-MM-DD)",
      },
      {
        field: "validUntil",
        label: "Valid until",
        need: "useful",
        why: "An expiry is the honest deadline to chase against.",
        ask: "Is there an expiry date on it?",
      },
      {
        field: "notes",
        label: "Notes",
        need: "useful",
        why: "What was included, what was discounted, what was promised verbally - the things a revision later has to be compared against.",
        ask: "Anything about the offer worth recording - scope, discount, conditions?",
      },
    ],
  },
  {
    tool: "set_reminder",
    purpose: "A nudge that arrives with enough context to be acted on without opening the app.",
    fields: [
      {
        field: "title",
        label: "What to do",
        need: "required",
        why: "A reminder with no subject is a notification that says nothing.",
        ask: "What should the reminder say?",
      },
      {
        field: "dueAt",
        label: "When",
        need: "required",
        why: "Without a time there is nothing to schedule. Use 'now' to send immediately.",
        ask: "When should it arrive? 'Now' sends it straight away.",
      },
      {
        field: "leadId",
        label: "Lead",
        need: "important",
        why: "Attaching a lead is what makes the email comprehensive: stage, owner, value and its provenance, who owes the next move, the latest proposal and the client rollup all travel with it. Without one the email carries only what you type.",
        ask: "Is this about a particular lead? Attaching one pulls its whole CRM state into the email.",
      },
      {
        field: "holdMinutes",
        label: "Calendar hold",
        need: "useful",
        why: "A calendar invitation blocks the time rather than merely mentioning it, so the work has somewhere to happen.",
        ask: "Should it block time in your calendar, and for how long - 15, 30 or 60 minutes?",
      },
      {
        field: "topic",
        label: "Topic",
        need: "useful",
        why: "The discussion it belongs to, which is what makes a run of reminders readable later.",
        ask: "What discussion or topic is it about?",
      },
    ],
  },
  {
    tool: "draft_outreach",
    purpose: "A message a human can read once and send without rewriting it.",
    fields: [
      {
        field: "id",
        label: "Lead",
        need: "required",
        why: "The template is rendered from the lead.",
        ask: "Which lead is the message for?",
      },
      {
        field: "template",
        label: "Template",
        need: "important",
        why: "The templates open very differently - a first approach, a follow-up and a re-engagement are not interchangeable, and the wrong one reads badly to someone who has already met us.",
        ask: "Which template - a first approach, a follow-up, or a re-engagement?",
      },
      {
        field: "to",
        label: "Recipient",
        need: "useful",
        why: "It defaults to the lead's contact email, which is wrong whenever the right reader is somebody else.",
        ask: "Send to the lead's contact address, or someone else?",
      },
    ],
  },
  {
    tool: "set_next_move",
    purpose: "A record of who owes what, so late-on-us and late-on-them stay different problems.",
    fields: [
      {
        field: "id",
        label: "Lead",
        need: "required",
        why: "The move belongs to one lead.",
        ask: "Which lead?",
      },
      {
        field: "waitingOn",
        label: "Who owes it",
        need: "important",
        why: "This is the whole point of the field. 'Us' is a backlog and 'them' is a chase list; they are different work and are counted separately. Unset leaves the lead untriaged.",
        ask: "Who owes the next move - us or them?",
      },
      {
        field: "followUpDate",
        label: "Due date",
        need: "important",
        why: "Without a date nothing can be late, so the lead never surfaces in the work queue however long it sits.",
        ask: "By when? (YYYY-MM-DD)",
      },
      {
        field: "nextStep",
        label: "What the move is",
        need: "useful",
        why: "'Waiting on them' with no next step tells the next reader nothing they can act on.",
        ask: "What is the move, in plain words?",
      },
    ],
  },
  {
    tool: "set_budget",
    purpose: "The expected value the ranking uses until a proposal replaces it.",
    fields: [
      {
        field: "id",
        label: "Lead",
        need: "required",
        why: "The value belongs to one lead.",
        ask: "Which lead?",
      },
      {
        field: "valueEur",
        label: "Value",
        need: "required",
        why: "The figure is the point of the call.",
        ask: "What is it expected to be worth, in euros?",
      },
      {
        field: "confidence",
        label: "Confidence",
        need: "important",
        why: "Confidence discounts the opportunity axis - Confirmed counts fully, Estimated at 0.6. Marking a guess as Confirmed inflates the ranking on evidence that does not exist.",
        ask: "Has the client actually agreed that figure, or is it still our estimate?",
      },
    ],
  },
  {
    tool: "set_strategic_value",
    purpose: "What a deal is worth beyond its invoice, capped so it can never outrank paid work.",
    fields: [
      {
        field: "id",
        label: "Lead",
        need: "required",
        why: "The rating belongs to one lead.",
        ask: "Which lead?",
      },
      {
        field: "value",
        label: "Rating",
        need: "required",
        why: "0 none, 1 some, 2 significant, 3 flagship.",
        ask: "How strategic is it - none, some, significant, or flagship?",
      },
      {
        field: "reason",
        label: "Reason",
        need: "important",
        why: "A rating with no reason is an opinion nobody can review. The reason comes from a fixed list precisely so it can be argued with later.",
        ask: "Why - the logo, a referral source, a reference case, or something else on the list?",
      },
    ],
  },
  {
    tool: "assign_lead",
    purpose: "Who owns the lead, and therefore who can see and work it.",
    fields: [
      {
        field: "id",
        label: "Lead",
        need: "required",
        why: "One lead changes hands at a time.",
        ask: "Which lead?",
      },
      {
        field: "owner",
        label: "New owner",
        need: "required",
        why: "Ownership decides record scope: the wrong name can take the lead out of the right person's view entirely.",
        ask: "Who should own it?",
      },
    ],
  },
  {
    tool: "add_comment",
    purpose: "A dated, attributed turn in the record's discussion, which the next person to open it will read.",
    fields: [
      {
        field: "leadId",
        label: "Lead",
        need: "required",
        why: "A comment belongs to one record.",
        ask: "Which lead is this about?",
      },
      {
        field: "body",
        label: "The comment",
        need: "required",
        why: "There is nothing to record without it.",
        ask: "What would you like to put on the record?",
      },
    ],
  },
];

const BY_TOOL = new Map<string, IntakeSpec>(INTAKE_SPECS.map((s) => [s.tool, s]));

export function intakeSpec(tool: string): IntakeSpec | null {
  return BY_TOOL.get(tool) ?? null;
}

/**
 * `false` is an answer, `""` is not.
 *
 * A user who says "no calendar hold" has told us something, and re-asking
 * would be worse than not asking at all. Blank strings and nulls are the
 * shapes a value takes when nobody has said anything.
 */
function isGiven(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function checkIntake(tool: string, provided: Record<string, unknown> = {}): IntakeCheck | null {
  const spec = BY_TOOL.get(tool);
  if (!spec) return null;

  const given = spec.fields.filter((f) => isGiven(provided[f.field]));
  const missing = spec.fields.filter((f) => !isGiven(provided[f.field]));
  const of = (need: IntakeNeed) => missing.filter((f) => f.need === need);

  const missingRequired = of("required");
  const missingImportant = of("important");
  const missingUseful = of("useful");
  const ordered = [...missingRequired, ...missingImportant, ...missingUseful];

  const ready = missingRequired.length === 0;
  const complete = missing.length === 0;

  const guidance = !ready
    ? "Do not call the tool yet. Ask the required questions - all of them in one message, not one at a time - and the important ones alongside."
    : complete
      ? "Nothing is missing. Offer the write as an actions block and let the user press it."
      : missingImportant.length > 0
        ? "The call would succeed, but the record would be weaker in the ways listed. Ask the important questions in one message, and say plainly that it can be submitted as-is if they would rather. If they say go ahead, go ahead."
        : "Good enough to submit. Mention what is still blank in one line rather than asking about it, and offer the write.";

  return {
    tool: spec.tool,
    purpose: spec.purpose,
    ready,
    complete,
    provided: given.map((f) => f.field),
    missingRequired,
    missingImportant,
    missingUseful,
    questions: ordered.map((f) => f.ask),
    consequences: [...missingRequired, ...missingImportant].map((f) => `${f.label}: ${f.why}`),
    guidance,
  };
}
