/**
 * What each field on a lead is for, and what it moves.
 *
 * The lead form asks for twenty things and explains almost none of them, so a
 * value gets typed to make the field stop being empty. That is how a pipeline
 * fills up with numbers nobody believes.
 *
 * Every entry answers the two questions a person actually has: what does this
 * mean, and what happens if I get it wrong. Where a field feeds the score, the
 * weight is stated - vague reassurance that something is "used in the ranking"
 * is what makes people stop reading.
 *
 * Pure data, no imports: the form renders it and a test checks it covers every
 * field the form asks for, so the two cannot drift.
 */
export interface FieldHelp {
  /** One line on what the field is. */
  what: string;
  /** What it changes downstream. Omitted when it changes nothing computed. */
  feeds?: string;
}

export const LEAD_FIELD_HELP: Record<string, FieldHelp> = {
  name: {
    what: "The brand or client, as you would say it out loud. Search matches on this, and so does duplicate detection when a second deal opens with the same client.",
  },
  status: {
    what: "Where the deal sits in the funnel: Seed, Qualify lead, Shape proposal, Closed deal, plus Recurring for repeat work and Lost.",
    feeds:
      "The stage win probability, which is 45% of the winnability axis and the multiplier behind weighted pipeline value. Leaving it blank treats the deal as not yet opened, so it counts as live but scores as cold.",
  },
  priority: {
    what: "Your read on the conversation: High, Medium or Low. A human label, not a calculation.",
    feeds:
      "Nothing in the ranking, on purpose. It exists so your instinct and the computed priority can disagree - and disagreement is the interesting signal.",
  },
  industry: {
    what: "The segment the brand belongs to.",
    feeds:
      "The industry scorecard, the whitespace map and the playbook advice. A lead with no industry is missing from all three, and its value cannot be compared with anything.",
  },
  owner: {
    what: "Who is accountable for the next move.",
    feeds:
      "The 'nobody owns this' headline, and record scope: someone limited to their own leads cannot see a lead owned by nobody, so an unowned deal can be invisible to the person best placed to work it.",
  },
  poc: {
    what: "The person at the brand you actually deal with.",
    feeds: "Search, and the greeting on any outreach drafted from this lead.",
  },
  email: {
    what: "The address outreach is sent to. Usually the point of contact's, but it can be whoever actually reads.",
    feeds: "Nothing computed, but without it the composer and the copilot both refuse to draft: there is nowhere to send it.",
  },
  initialContact: {
    what: "The day this stopped being a name on a list and became a conversation.",
    feeds:
      "The measured duration of the deal once it closes, which is what replaces your estimate in the pace report.",
  },
  lastContact: {
    what: "The last time either side actually said anything to the other.",
    feeds:
      "Freshness, which is 25% of the winnability axis. It halves every six months of silence and floors at a quarter, so a stale lead loses rank without ever leaving the pipeline. It is also what 'gone quiet' counts, at 90 days.",
  },
  followUpDate: {
    what: "When the next move is due, whichever side owes it.",
    feeds:
      "The work queue and the overdue counts. With no date nothing can be late, so the lead can sit untouched for a year without ever appearing on anyone's list.",
  },
  closingFailed: {
    what: "The day the deal closed or was written off.",
    feeds:
      "The real elapsed duration, which replaces the estimate once the deal is finished. That is how the pace report learns whether the estimates are any good.",
  },
  waitingOn: {
    what: "Which side owes the next move: us, or them. The single most useful field on this form.",
    feeds:
      "The split between 'to reply' and 'to follow up'. The same overdue date means opposite things depending on the side, so merging them into one 'overdue' number hides a backlog inside a chase list. Left blank it is inferred - a sent proposal means them, a lone follow-up date means us - and reported as untriaged when neither applies.",
  },
  expectedMonths: {
    what: "How long you think this will take, in months.",
    feeds:
      "The pace report, where it is compared with what deals actually took. It deliberately does NOT move the ranking: an optimistic guess should not promote a lead.",
  },
  nextStep: {
    what: "The move itself, in plain words - 'send revised quote', 'chase legal'.",
    feeds: "Nothing computed. It is what the next person to open this lead reads instead of guessing.",
  },
  budget: {
    what: "What you expect the engagement to be worth, in euros.",
    feeds:
      "The opportunity axis, which is 75% money. Priority is the geometric mean of opportunity and winnability, so a lead with no value scores ZERO however winnable it is - it cannot be ranked at all and is absent from the pipeline total. The figure is capped at €80k for scoring, so a very large deal does not flatten everything else.",
  },
  assumption: {
    what: "Whether the client has agreed that figure, or it is still your estimate.",
    feeds:
      "How much the value is discounted: Confirmed counts at 1.0, Estimated at 0.6, unstated at 0.4. Marking a guess Confirmed inflates the ranking on evidence that does not exist.",
  },
  strategicValue: {
    what: "What the deal is worth beyond the invoice, 0 to 3: a logo, a referral source, a reference case.",
    feeds:
      "Up to a quarter of the opportunity axis, and never more. That cap is deliberate - it lets a free project stay visible without ever outranking paid work on its own.",
  },
  strategicReason: {
    what: "Why it is strategic, chosen from a fixed list.",
    feeds:
      "Nothing computed. The list is fixed so that 'strategic' has to mean something specific, and so the rating can be argued with later.",
  },
  customizationScore: {
    what: "How productised the work is, 0 to 5. Five is something we already make; one is built from scratch.",
    feeds:
      "The ease index, which is reported and breaks ties but is NEVER blended into priority. Letting 'easy' inflate the ranking was the flaw in the previous model.",
  },
  accessibilityScore: {
    what: "How easily we reach the people who actually decide, 0 to 5.",
    feeds: "15% of the winnability axis, and the ease index.",
  },
  receptivityScore: {
    what: "How warmly they engage once we do reach them, 0 to 5.",
    feeds: "15% of the winnability axis, and the ease index.",
  },
  alignmentScore: {
    what: "How well the brand fits what OOVIE makes, 0 to 5.",
    feeds: "The ease index only. Fit makes a deal pleasant to deliver; it does not make it more likely to close.",
  },
  notes: {
    what: "The first note: what this lead is, how it came in, what to be careful of. Anything learned later is appended to the notes thread on the lead page instead, attributed and dated, so this one stays as written.",
    feeds:
      "Search, every export and any reminder email about this lead, which all lead with it. Saving replaces it, which is why later additions go to the thread rather than here."
  },
};
