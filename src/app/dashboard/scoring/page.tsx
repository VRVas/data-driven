import { Reveal } from "@/components/Reveal";
import { Badge } from "@/components/Badge";
import { ChartCard } from "@/components/ChartCard";
import { PriorityQuadrant, type QuadPoint } from "@/components/viz/PriorityQuadrant";
import { ScoringExplainer } from "@/components/ScoringExplainer";
import { getVisibleScoredBrands } from "@/lib/leads/visible";
import { openLeads } from "@/lib/lifecycle";
import { PRIORITY_TOKEN, leadScore, effectiveScores, eur } from "@/lib/scoring";
import { rankByPriority, priorityOf, type Grade } from "@/lib/priority";
import { ExportMenu } from "@/components/ExportMenu";
import type { Column } from "@/lib/export";

export const dynamic = "force-dynamic";

const GRADE_TOKEN: Record<Grade, string> = {
  A: "var(--color-mint)",
  B: "var(--color-cyan)",
  C: "var(--color-amber)",
  D: "var(--color-ink-faint)",
};

const SCORE_COLS: Column[] = [
  { key: "name", label: "Brand" },
  { key: "industry", label: "Industry" },
  { key: "priority", label: "Priority" },
  { key: "grade", label: "Grade" },
  { key: "quadrant", label: "Quadrant" },
  { key: "opportunity", label: "Opportunity" },
  { key: "winnability", label: "Winnability" },
  { key: "ease", label: "Ease" },
  { key: "expectedValueEur", label: "Expected value (EUR)" },
  { key: "budget", label: "Budget (EUR)" },
  { key: "adjustedBudget", label: "Budget × confidence (EUR)" },
  { key: "strategicValue", label: "Strategic value" },
  { key: "leadScore", label: "Old lead score" },
  { key: "customization", label: "Customization" },
  { key: "accessibility", label: "Accessibility" },
  { key: "receptivity", label: "Receptivity" },
  { key: "alignment", label: "Alignment" },
];

const MODEL = [
  { name: "Opportunity", desc: "What it is worth: budget × how much evidence backs it, capped at €80k, plus strategic value (max a quarter of the axis).", range: "0-100" },
  { name: "Winnability", desc: "Whether it closes: stage 45%, freshness 25%, reachable decision-makers 15%, receptivity 15%.", range: "0-100" },
  { name: "Priority", desc: "√(Opportunity × Winnability). A geometric mean, so weakness on one axis cannot be averaged away by strength on the other.", range: "0-100" },
  { name: "Ease", desc: "What it costs to run - customization, accessibility, receptivity, alignment. Reported and used to break ties, never blended into priority.", range: "0-100" },
  { name: "Expected value", desc: "Adjusted budget × stage probability × freshness. Shown in euros beside the priority, never folded into it.", range: "€" },
  { name: "Strategic value", desc: "0-3 for worth beyond the invoice - a logo, a referral source, a reference case. Capped so it cannot outrank paid work alone.", range: "0-3" },
];

export default async function ScoringPage() {
  const scored = await getVisibleScoredBrands();
  // Targeting views rank where to spend effort next, so finished deals are out.
  const live = openLeads(scored);
  const ranked = rankByPriority(live);
  const points: QuadPoint[] = ranked.map(({ brand, p }) => ({
    id: brand.id,
    name: brand.name,
    x: p.winnability,
    y: p.opportunity,
    budget: brand.scores?.budget ?? 0,
    color: brand.priority ? PRIORITY_TOKEN[brand.priority] : "var(--color-ink-faint)",
  }));

  const scoreRowsFrom = (list: typeof scored): Record<string, unknown>[] =>
    list.map((b) => {
      const s = effectiveScores(b);
      const p = priorityOf(b);
      return {
        name: b.name,
        industry: b.industry,
        priority: p?.priority ?? null,
        grade: p?.grade ?? null,
        quadrant: p?.quadrant ?? null,
        opportunity: p ? Math.round(p.opportunity) : null,
        winnability: p ? Math.round(p.winnability) : null,
        ease: p ? Math.round(p.ease) : null,
        expectedValueEur: p ? Math.round(p.expectedValueEur) : null,
        budget: s?.budget ?? null,
        adjustedBudget: p ? Math.round(p.adjustedBudget) : null,
        strategicValue: b.strategicValue ?? 0,
        // Kept for one cycle so the team can see what moved and why.
        leadScore: leadScore(b),
        customization: s?.customizationScore ?? null,
        accessibility: s?.accessibilityScore ?? null,
        receptivity: s?.receptivityScore ?? null,
        alignment: s?.alignmentScore ?? null,
      };
    });

  return (
    <div className="space-y-8">
      <Reveal>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 basis-64">
            <h1 className="font-display text-3xl font-semibold tracking-tight">Scoring model</h1>
            <p className="mt-1 max-w-2xl text-[var(--color-ink-muted)]">
              Leads are ranked by <strong>Priority</strong> - what a deal is worth against how likely it is to
              close. The two are combined with a geometric mean, so being easy can no longer make up for
              being worthless.
            </p>
          </div>
          <ExportMenu
            filename="scoring"
            columns={SCORE_COLS}
            rows={scoreRowsFrom(live)}
            allRows={scoreRowsFrom(scored)}
          />
        </div>
      </Reveal>

      <Reveal stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODEL.map((m) => (
          <div key={m.name} className="glass p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">{m.name}</h3>
              <span className="text-xs text-[var(--color-brand-bright)]">{m.range}</span>
            </div>
            <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{m.desc}</p>
          </div>
        ))}
      </Reveal>

      <div className="grid gap-6 lg:grid-cols-2">
        <Reveal className="h-full min-w-0">
          <ChartCard
            id="scoring-quadrant"
            title="Priority quadrant"
            subtitle={`${points.length} open leads - won and lost deals are excluded`}
          >
            <PriorityQuadrant points={points} />
          </ChartCard>
        </Reveal>

        <Reveal className="h-full min-w-0">
          <ChartCard
            id="scoring-ranked"
            title="Top-ranked leads"
            subtitle="Where to spend effort next - won and lost deals are excluded"
          >
            <ol className="space-y-1.5">
              {ranked.slice(0, 12).map(({ brand, p }, i) => (
                <li key={brand.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 hover:bg-[var(--color-surface)] sm:flex">
                  <span className="row-span-2 w-5 shrink-0 text-right text-sm text-[var(--color-ink-faint)]">{i + 1}</span>
                  <span className="col-span-2 min-w-0 flex-1 break-words font-medium">{brand.name}</span>
                  <span className="col-start-2 row-start-2 text-xs text-[var(--color-ink-muted)]">{p.quadrant}</span>
                  <span className="col-start-3 row-start-2 w-16 shrink-0 text-right text-sm text-[var(--color-ink-muted)]">
                    {brand.scores?.budget ? eur(brand.scores.budget) : "-"}
                  </span>
                  <Badge color={GRADE_TOKEN[p.grade]}>{p.grade}</Badge>
                  <span className="col-start-4 row-start-1 w-10 shrink-0 text-right font-display font-semibold tabular-nums text-[var(--color-brand-bright)]">
                    {p.priority}
                  </span>
                </li>
              ))}
            </ol>
          </ChartCard>
        </Reveal>
      </div>

      <Reveal>
        <div data-tour="scoring-reference" className="glass p-6">
          <h2 className="font-display text-xl font-semibold tracking-tight">How the numbers are worked out</h2>
          <p className="mb-6 mt-1 max-w-3xl text-sm text-[var(--color-ink-muted)]">
            Every field, every weight, every threshold, and what has no effect at all. Rendered from the same
            constants the ranking uses, so this page cannot drift away from the code.
          </p>
          <ScoringExplainer />
        </div>
      </Reveal>
    </div>
  );
}
