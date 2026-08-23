import "server-only";
import {
  BUDGET_CEILING,
  CONFIDENCE,
  GRADE_BANDS,
  OI_WEIGHTS,
  PURSUE_OI,
  PURSUE_WI,
  RECENCY_FLOOR,
  RECENCY_HALF_LIFE_MONTHS,
  STRATEGIC_REASONS,
  WI_WEIGHTS,
  confidenceFor,
  priorityOf,
  recencyOf,
} from "@/lib/priority";
import { STAGE_PROBABILITY, effectiveScores, effectiveTempoMonths, leadScore } from "@/lib/scoring";
import { STALE_DAYS } from "@/lib/pipeline/health";
import type { Brand } from "@/lib/types";

/**
 * The model, written out for the copilot.
 *
 * Built from the same constants the ranking uses, so it cannot describe a
 * version of the scoring that no longer exists — the failure mode of writing
 * this into the system prompt, where it is expensive on every call and drifts
 * the first time a weight changes.
 */

const OPEN_STAGE_MAX = STAGE_PROBABILITY.Recurring;

export function modelSpec() {
  return {
    recalculation:
      "Every read. Nothing is stored or cached: a lead is scored from whatever it holds the moment a page renders or a tool runs, so an edit shows up on the next load. Recency is the one input that moves on its own — it decays with the calendar, so an untouched lead drifts down without anybody editing it.",

    priority: {
      formula: "priority = round(sqrt(opportunity * winnability))",
      why: "A geometric mean, so weakness on one axis cannot be averaged away by strength on the other. Zero opportunity is fatal outright — which is the €0 case. Winnability cannot reach zero because its recency term is floored, so an unwinnable deal bottoms out low rather than nulling, which is right: a large deal going nowhere still deserves a glance.",
      nullWhen: "The lead has no score record at all. Nothing has been judged, so there is nothing to rank.",
      range: "0–100",
      grades: GRADE_BANDS.map((b, i) => ({
        grade: b.grade,
        from: b.from,
        to: i === 0 ? 100 : GRADE_BANDS[i - 1].from - 1,
      })),
    },

    opportunity: {
      question: "What is this worth?",
      formula: `opportunity = min(100, ${OI_WEIGHTS.money} * moneyIndex + ${OI_WEIGHTS.strategic} * strategicIndex)`,
      terms: {
        moneyIndex: {
          formula: `100 * min(1, budget * confidence / ${BUDGET_CEILING})`,
          ceilingEur: BUDGET_CEILING,
          note: "Anything above the ceiling scores the same. The axis measures whether a deal is big, not how big.",
        },
        confidence: {
          values: CONFIDENCE,
          note: "How much of a stated budget to believe. An accepted proposal is what makes a budget Confirmed, so this rewards evidence rather than optimism. 'unstated' applies when no assumption was recorded.",
        },
        strategicIndex: {
          formula: "100 * strategicValue / 3",
          scale: "0 none beyond the invoice · 1 some · 2 significant · 3 flagship",
          reasons: STRATEGIC_REASONS,
          cap: `Capped at ${Math.round(OI_WEIGHTS.strategic * 100)}% of the axis, so a flagship freebie stays visible without outranking paid work on its own.`,
        },
      },
    },

    winnability: {
      question: "Will it actually close?",
      formula: `winnability = 100 * clamp01(${WI_WEIGHTS.stage} * stage + ${WI_WEIGHTS.recency} * recency + ${WI_WEIGHTS.accessibility} * accessibility + ${WI_WEIGHTS.receptivity} * receptivity)`,
      terms: {
        stage: {
          weight: WI_WEIGHTS.stage,
          formula: `clamp01(stageProbability / ${OPEN_STAGE_MAX})`,
          probabilities: STAGE_PROBABILITY,
          note: `Divided by the strongest OPEN stage (Recurring, ${OPEN_STAGE_MAX}) so an open lead can reach the full weight.`,
        },
        recency: {
          weight: WI_WEIGHTS.recency,
          formula: `max(${RECENCY_FLOOR}, 0.5 ^ (monthsSinceLastContact / ${RECENCY_HALF_LIFE_MONTHS}))`,
          halfLifeMonths: RECENCY_HALF_LIFE_MONTHS,
          floor: RECENCY_FLOOR,
          source: "lastContact, falling back to initialContact. With neither date, or a date in the future, it sits at the floor.",
        },
        accessibility: { weight: WI_WEIGHTS.accessibility, formula: "clamp01(accessibilityScore / 5)" },
        receptivity: { weight: WI_WEIGHTS.receptivity, formula: "clamp01(receptivityScore / 5)" },
      },
    },

    quadrant: {
      thresholds: { opportunity: PURSUE_OI, winnability: PURSUE_WI },
      rules: {
        Pursue: `opportunity >= ${PURSUE_OI} and winnability >= ${PURSUE_WI} — worth having and gettable.`,
        Invest: `opportunity >= ${PURSUE_OI} and winnability < ${PURSUE_WI} — worth having, not yet gettable.`,
        "Quick win": `opportunity < ${PURSUE_OI} and winnability >= ${PURSUE_WI} — gettable, small.`,
        Park: "Below both. Not now.",
      },
    },

    ease: {
      formula: "ease = 100 * (customization + accessibility + receptivity + alignment) / 20",
      note: "What the deal costs to run. Reported beside priority and used only to break ties inside a ranking — deliberately NEVER blended into priority, because a cheap deal being easy is not a reason to want it.",
    },

    expectedValue: {
      formula: "expectedValueEur = budget * confidence * stageProbability * recency",
      note: "Shown in euros next to the priority, never folded into it. This is the candidate-A number kept for comparison.",
    },

    notInTheRanking: [
      "expectedMonths (how long the deal takes) — changing it will NEVER move a bubble. Duration is a cost of running a deal, not a reason to want it or a reason it closes, so it feeds economical efficiency and the tempo report instead.",
      "customizationScore and alignmentScore — reported as Ease, never blended.",
      "priority label (Hot/Warm/Cold Lead) — a human tag. It colours the bubble and sorts the table; it does not score.",
      "owner, industry, nextStep, notes, poc, email — filters and context.",
      "waitingOn and followUpDate — they drive the health view, not the ranking.",
    ],

    money: {
      oneValuePerDeal: {
        order: ["accepted", "quoted", "estimate", "none"],
        rules: {
          accepted: "The newest ACCEPTED proposal. An acceptance is a fact and does not expire, so it outranks a later draft or a rejected re-quote.",
          quoted: "The newest revision, when that revision is SENT and awaiting a decision.",
          estimate: "The budget recorded on the lead — what somebody typed when it opened.",
          none: "Nobody has put a figure on it. Reported as no value rather than as €0.",
        },
        note: "The lead's own budget is kept in step with this whenever a proposal is recorded or deleted, so the ranking and the money totals read the same number.",
      },
      totals: {
        openPipeline: "Deals still open — every stage except Deal Closed and Did not work out.",
        weightedPipeline: "The same deals, each multiplied by its stage probability. Won deals are excluded: at probability 1.0 they would add banked revenue to a pipeline figure.",
        awaitingDecision: "Proposals whose newest revision is SENT, on deals that are still open. A re-quote replaces the earlier figure rather than adding to it, and a proposal left marked sent on a deal since won or lost is stale, not outstanding.",
        lifetimeValue: "Deals at Deal Closed, valued at what was banked.",
        repeatValue: "Lifetime value beyond the first win — what the relationship earned after landing it.",
        proposalWinRate: "Accepted / decided, one vote per deal decided by its most recent accept or reject. A deal re-quoted twice and finally won counts as one win.",
      },
    },

    health: {
      waitingOn: {
        explicit: "Somebody set it on the lead. Always wins.",
        proposal: "Inferred: a proposal is out for decision, so the ball is with them.",
        followUp: "Inferred: there is a follow-up date but nobody said who owes the move, so it is taken as ours.",
        none: "Nobody has said and there is nothing to infer from — reported as untriaged rather than guessed.",
        note: "Always say whether a side was stated or inferred when it matters to the answer.",
      },
      late: "dueDate in the past, where dueDate is followUpDate, falling back to the current proposal's validUntil. A closed deal owes nobody anything, so it is never late.",
      staleDays: STALE_DAYS,
      stale: `No contact for more than ${STALE_DAYS} days, on an open deal.`,
    },

    tempo: {
      meaning: "How long the deal TAKES — duration, not silence.",
      resolution: "The real elapsed time from initialContact to closingFailed once the deal has closed; before that, expectedMonths, falling back to the sheet's imported tempoMonths.",
      score: "tempoScore = clamp((10 - months * 10 / 8) / 2, 0, 5) — 0 at eight months or longer.",
      consumers: "economicalEfficiency only, plus the tempo report. Not the priority.",
    },

    legacyScore: {
      formula: "leadScore = economicalEfficiency * 0.55 + easeOfAccess * 0.45",
      economicalEfficiency: "mean(budgetScore, customizationScore, tempoScore) — null unless all three are known.",
      easeOfAccess: "mean(accessibilityScore, alignmentScore, receptivityScore) — null unless all three are known.",
      budgetScore: `clamp(raw / 2, 0, 5) where raw = 1 for €1–15,999 and 10 * budget / ${BUDGET_CEILING} above that. The discontinuity at €16,000 is inherited from the workbook.`,
      status:
        "Superseded. It averaged six 0–5 rubric numbers, which made budget worth 0.55/3 = 18.3% of the result — €80,000 of revenue counting for about six points of brand-message alignment, and a €0 project able to average its way into third place. Shown beside the new score for one cycle so the team can see what moved. Often null for leads created in the app, because it needs tempo and the rubric as well as a budget.",
    },
  };
}

/** Every intermediate value for one lead, so an explanation can quote real numbers. */
export function workedExample(brand: Brand, now: Date = new Date()) {
  const p = priorityOf(brand, now);
  const s = effectiveScores(brand);
  if (!p || !s) {
    return {
      id: brand.id,
      name: brand.name,
      rankable: false,
      reason: "This lead has no score record, so it has no priority. Give it a commercial value and it becomes rankable.",
    };
  }

  const tempo = effectiveTempoMonths(brand);
  const budget = s.budget ?? 0;
  const confidence = confidenceFor(s.assumption);

  return {
    id: brand.id,
    name: brand.name,
    rankable: true,
    inputs: {
      budgetEur: s.budget,
      assumption: s.assumption ?? "unstated",
      strategicValue: brand.strategicValue ?? 0,
      status: brand.status,
      lastContact: brand.lastContact,
      initialContact: brand.initialContact,
      accessibilityScore: s.accessibilityScore,
      receptivityScore: s.receptivityScore,
      customizationScore: s.customizationScore,
      alignmentScore: s.alignmentScore,
    },
    opportunity: {
      confidence,
      adjustedBudgetEur: p.adjustedBudget,
      moneyIndex: p.moneyIndex,
      strategicIndex: p.strategicIndex,
      result: p.opportunity,
      arithmetic: `min(100, ${OI_WEIGHTS.money} * ${p.moneyIndex.toFixed(1)} + ${OI_WEIGHTS.strategic} * ${p.strategicIndex.toFixed(1)}) = ${p.opportunity.toFixed(1)}`,
    },
    winnability: {
      stageProbability: p.winProbability,
      stageTerm: Math.min(1, p.winProbability / OPEN_STAGE_MAX),
      recency: p.recency,
      monthsOfSilence: recencyOf(brand, now) === RECENCY_FLOOR ? null : Math.log2(1 / p.recency) * RECENCY_HALF_LIFE_MONTHS,
      accessibilityTerm: Math.min(1, (s.accessibilityScore ?? 0) / 5),
      receptivityTerm: Math.min(1, (s.receptivityScore ?? 0) / 5),
      result: p.winnability,
    },
    priority: p.priority,
    grade: p.grade,
    quadrant: p.quadrant,
    arithmetic: `round(sqrt(${p.opportunity.toFixed(1)} * ${p.winnability.toFixed(1)})) = ${p.priority}`,
    ease: p.ease,
    expectedValueEur: p.expectedValueEur,
    tempo: { months: tempo.months, basis: tempo.basis, note: "Does not affect the priority above." },
    legacyLeadScore: leadScore(brand),
    whatWouldMoveIt: [
      budget * confidence < BUDGET_CEILING
        ? `Money is the binding term: at €${Math.round(budget * confidence).toLocaleString()} of believed budget it scores ${p.moneyIndex.toFixed(0)}/100. ${s.assumption === "Confirmed" ? "" : "Getting the budget confirmed by an accepted proposal would raise the believed figure without changing the number itself."}`
        : "Money is already at the ceiling; more budget will not raise the score.",
      p.recency < 1 ? `Recency is at ${p.recency.toFixed(2)} of 1 — making contact resets it.` : "Recency is at full.",
      (s.accessibilityScore ?? 0) < 5 || (s.receptivityScore ?? 0) < 5
        ? "Accessibility and receptivity are judgements you can revise on the lead; together they are worth 30% of winnability."
        : "Reachability is already at full.",
    ],
  };
}
