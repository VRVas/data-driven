import {
  BUDGET_CEILING,
  CONFIDENCE,
  GRADE_BANDS,
  OI_WEIGHTS,
  PURSUE_OI,
  PURSUE_WI,
  RECENCY_FLOOR,
  RECENCY_HALF_LIFE_MONTHS,
  WI_WEIGHTS,
} from "@/lib/priority";
import { STAGE_PROBABILITY } from "@/lib/scoring";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const eur0 = (n: number) => `€${n.toLocaleString("en-GB")}`;

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <code className="block overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-[13px] text-[var(--color-ink)]">
      {children}
    </code>
  );
}

function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2 text-sm">
      <span className="min-w-[9rem] font-medium text-[var(--color-ink)]">{label}</span>
      <span className="flex-1 text-[var(--color-ink-muted)]">{children}</span>
    </div>
  );
}

/**
 * The model written out in full, rendered from the constants it documents so
 * the two cannot drift apart.
 */
export function ScoringExplainer() {
  const openStages = Object.entries(STAGE_PROBABILITY)
    .filter(([status]) => status !== "Deal Closed" && status !== "Did not work out")
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-8">
      <section>
        <h3 className="font-display text-base font-semibold">Opportunity - what it is worth</h3>
        <div className="mt-3 space-y-3">
          <Formula>
            opportunity = min(100, {OI_WEIGHTS.money} × moneyIndex + {OI_WEIGHTS.strategic} × strategicIndex)
          </Formula>
          <Term label="moneyIndex">
            100 × min(1, budget × confidence ÷ {eur0(BUDGET_CEILING)}). Anything above the ceiling scores the
            same - the axis measures whether a deal is big, not how big.
          </Term>
          <Term label="confidence">
            Confirmed {CONFIDENCE.Confirmed} - Estimated {CONFIDENCE.Estimated} - nothing stated{" "}
            {CONFIDENCE.unstated}. An accepted proposal is what makes a budget Confirmed, so this rewards
            evidence rather than optimism.
          </Term>
          <Term label="strategicIndex">
            100 × strategicValue ÷ 3, capped at {pct(OI_WEIGHTS.strategic)} of the axis so a flagship freebie
            stays visible without outranking paid work on its own.
          </Term>
        </div>
      </section>

      <section>
        <h3 className="font-display text-base font-semibold">Winnability - whether it closes</h3>
        <div className="mt-3 space-y-3">
          <Formula>
            winnability = 100 × ({WI_WEIGHTS.stage} × stage + {WI_WEIGHTS.recency} × recency +{" "}
            {WI_WEIGHTS.accessibility} × accessibility + {WI_WEIGHTS.receptivity} × receptivity)
          </Formula>
          <Term label={`stage - ${pct(WI_WEIGHTS.stage)}`}>
            {openStages.map(([status, p], i) => (
              <span key={status}>
                {i > 0 && " - "}
                {status} {p}
              </span>
            ))}
            . Divided by the strongest open stage, so an open lead can reach the full weight.
          </Term>
          <Term label={`recency - ${pct(WI_WEIGHTS.recency)}`}>
            Halves every {RECENCY_HALF_LIFE_MONTHS} months since last contact, never below {RECENCY_FLOOR}.
            With no contact dates at all it sits at the floor.
          </Term>
          <Term label={`accessibility - ${pct(WI_WEIGHTS.accessibility)}`}>
            Your 0-5 judgement, divided by 5.
          </Term>
          <Term label={`receptivity - ${pct(WI_WEIGHTS.receptivity)}`}>Your 0-5 judgement, divided by 5.</Term>
        </div>
      </section>

      <section>
        <h3 className="font-display text-base font-semibold">Priority and grade</h3>
        <div className="mt-3 space-y-3">
          <Formula>priority = round(√(opportunity × winnability))</Formula>
          <p className="text-sm text-[var(--color-ink-muted)]">
            A geometric mean, so a weak axis cannot be averaged away by a strong one. Zero opportunity is fatal
            outright; winnability cannot reach zero, because its recency term is floored - an unwinnable deal
            bottoms out low rather than vanishing, which is right for a large deal going nowhere.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--color-ink-muted)]">
            {GRADE_BANDS.map((b, i) => (
              <span key={b.grade}>
                <span className="font-medium text-[var(--color-ink)]">{b.grade}</span>{" "}
                {i === GRADE_BANDS.length - 1 ? `below ${GRADE_BANDS[i - 1].from}` : `${b.from} and above`}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h3 className="font-display text-base font-semibold">Which quadrant a bubble lands in</h3>
        <div className="mt-3 space-y-3">
          <p className="text-sm text-[var(--color-ink-muted)]">
            Two thresholds, nothing else: opportunity {PURSUE_OI} and winnability {PURSUE_WI}.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Term label="Pursue">
              opportunity ≥ {PURSUE_OI} and winnability ≥ {PURSUE_WI} - worth having and gettable.
            </Term>
            <Term label="Invest">
              opportunity ≥ {PURSUE_OI}, winnability &lt; {PURSUE_WI} - worth having, not yet gettable.
            </Term>
            <Term label="Quick win">
              opportunity &lt; {PURSUE_OI}, winnability ≥ {PURSUE_WI} - gettable, small.
            </Term>
            <Term label="Park">Below both. Not now.</Term>
          </div>
        </div>
      </section>

      <section>
        <h3 className="font-display text-base font-semibold">What does not move a bubble</h3>
        <p className="mt-2 max-w-3xl text-sm text-[var(--color-ink-muted)]">
          Only the six inputs above have any effect: budget, its confidence, strategic value, stage, last
          contact, accessibility and receptivity. Everything else on a lead is recorded and reported without
          entering the ranking.
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-[var(--color-ink-muted)]">
          <li>
            <span className="text-[var(--color-ink)]">Expected duration</span> - changing it will never move a
            bubble. How long a deal takes is a cost of running it, not a reason to want it or a reason it
            closes, so it feeds economical efficiency and the tempo report instead. Blending it in was how a
            slow, valuable deal used to be ranked below a fast, worthless one.
          </li>
          <li>
            <span className="text-[var(--color-ink)]">Customization and alignment</span> - reported as Ease,
            deliberately never blended into priority.
          </li>
          <li>
            <span className="text-[var(--color-ink)]">Priority label</span> (High/Medium/Low) - a human tag. It
            colours the bubble and sorts the table; it does not score.
          </li>
          <li>
            <span className="text-[var(--color-ink)]">Owner, industry, next step, notes</span> - filters and
            context.
          </li>
        </ul>
      </section>

      <section>
        <h3 className="font-display text-base font-semibold">When it recalculates</h3>
        <p className="mt-2 max-w-3xl text-sm text-[var(--color-ink-muted)]">
          On every read. Nothing is stored or cached, so a lead is scored from whatever it holds the moment the
          page renders - save an edit and the new position is there on the next load. Recency is the one input
          that moves on its own: it decays with the calendar, so a lead nobody touches drifts down without
          anybody editing it.
        </p>
      </section>
    </div>
  );
}
