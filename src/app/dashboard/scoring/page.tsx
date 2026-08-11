import { Reveal } from "@/components/Reveal";
import { PriorityQuadrant, type QuadPoint } from "@/components/viz/PriorityQuadrant";
import { getScoredBrands } from "@/lib/data";
import { openLeads } from "@/lib/lifecycle";
import { PRIORITY_TOKEN, leadScore, quadrant, eur } from "@/lib/scoring";
import { ExportMenu } from "@/components/ExportMenu";
import type { Column } from "@/lib/export";

export const dynamic = "force-dynamic";

const SCORE_COLS: Column[] = [
  { key: "name", label: "Brand" },
  { key: "industry", label: "Industry" },
  { key: "leadScore", label: "Lead score" },
  { key: "economicalEfficiency", label: "Econ. efficiency" },
  { key: "easeOfAccess", label: "Ease of access" },
  { key: "budget", label: "Budget (EUR)" },
  { key: "tempo", label: "Tempo" },
  { key: "budgetScore", label: "Budget score" },
  { key: "customization", label: "Customization" },
  { key: "accessibility", label: "Accessibility" },
  { key: "receptivity", label: "Receptivity" },
  { key: "alignment", label: "Alignment" },
];

const MODEL = [
  { name: "Tempo", desc: "Freshness — months since last contact, inverted. Recent = high.", range: "0–5" },
  { name: "Budget", desc: "Client budget per event, €0–80k mapped onto the scale.", range: "0–5" },
  { name: "Customization", desc: "Tailoring effort required (catalog = easy, bespoke = hard).", range: "1–5" },
  { name: "Accessibility", desc: "How reachable senior decision-makers are.", range: "1–5" },
  { name: "Receptivity", desc: "How easily the concept is understood.", range: "1–5" },
  { name: "Alignment", desc: "Fit with OOVIE's five core messages (1 pt each).", range: "1–5" },
];

export default async function ScoringPage() {
  const scored = await getScoredBrands();
  // Targeting views rank where to spend effort next, so finished deals are out.
  const live = openLeads(scored);
  const points: QuadPoint[] = live
    .filter((b) => b.scores?.economicalEfficiency != null && b.scores?.easeOfAccess != null)
    .map((b) => ({
      id: b.id,
      name: b.name,
      x: b.scores!.easeOfAccess!,
      y: b.scores!.economicalEfficiency!,
      budget: b.scores!.budget ?? 0,
      color: b.priority ? PRIORITY_TOKEN[b.priority] : "var(--color-ink-faint)",
    }));

  const ranked = [...live]
    .map((b) => ({ b, score: leadScore(b) }))
    .filter((r) => r.score != null)
    .sort((a, b) => (b.score! - a.score!))
    .slice(0, 12);

  const scoreRowsFrom = (list: typeof scored): Record<string, unknown>[] =>
    list.map((b) => ({
      name: b.name,
      industry: b.industry,
      leadScore: leadScore(b),
      economicalEfficiency: b.scores?.economicalEfficiency ?? null,
      easeOfAccess: b.scores?.easeOfAccess ?? null,
      budget: b.scores?.budget ?? null,
      tempo: b.scores?.tempoScore ?? null,
      budgetScore: b.scores?.budgetScore ?? null,
      customization: b.scores?.customizationScore ?? null,
      accessibility: b.scores?.accessibilityScore ?? null,
      receptivity: b.scores?.receptivityScore ?? null,
      alignment: b.scores?.alignmentScore ?? null,
    }));

  return (
    <div className="space-y-8">
      <Reveal>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow mb-2">Model</div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Scoring model</h1>
            <p className="mt-1 max-w-2xl text-[var(--color-ink-muted)]">
              Six sub-scores roll up into <strong>Economical Efficiency</strong> (budget · customization ·
              tempo) and <strong>Ease of Access</strong> (accessibility · alignment · receptivity).
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
        <Reveal>
          <div className="glass p-6">
            <h2 className="font-display text-lg font-semibold">Priority quadrant</h2>
            <p className="mb-4 mt-1 text-sm text-[var(--color-ink-muted)]">
              {points.length} open leads · won and lost deals are excluded
            </p>
            <PriorityQuadrant points={points} />
          </div>
        </Reveal>

        <Reveal>
          <div className="glass p-6">
            <h2 className="font-display text-lg font-semibold">Top-ranked leads</h2>
            <p className="mb-4 mt-1 text-sm text-[var(--color-ink-muted)]">
              Where to spend effort next · won and lost deals are excluded
            </p>
            <ol className="space-y-1.5">
              {ranked.map((r, i) => {
                const q = quadrant(r.b.scores!.economicalEfficiency!, r.b.scores!.easeOfAccess!);
                return (
                  <li key={r.b.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--color-surface)]">
                    <span className="w-5 text-right text-sm text-[var(--color-ink-faint)]">{i + 1}</span>
                    <span className="flex-1 font-medium">{r.b.name}</span>
                    <span className="text-xs text-[var(--color-ink-muted)]">{q}</span>
                    <span className="w-16 text-right text-sm text-[var(--color-ink-muted)]">{r.b.scores?.budget ? eur(r.b.scores.budget) : "—"}</span>
                    <span className="w-10 text-right font-display font-semibold text-[var(--color-brand-bright)]">{r.score!.toFixed(2)}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </Reveal>
      </div>
    </div>
  );
}
