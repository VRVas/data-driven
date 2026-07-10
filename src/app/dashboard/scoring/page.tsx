import { Reveal } from "@/components/Reveal";
import { PriorityQuadrant, type QuadPoint } from "@/components/viz/PriorityQuadrant";
import { getScoredBrands } from "@/lib/data";
import { PRIORITY_TOKEN, leadScore, quadrant, eur } from "@/lib/scoring";

export const dynamic = "force-dynamic";

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
  const points: QuadPoint[] = scored
    .filter((b) => b.scores?.economicalEfficiency != null && b.scores?.easeOfAccess != null)
    .map((b) => ({
      id: b.id,
      name: b.name,
      x: b.scores!.easeOfAccess!,
      y: b.scores!.economicalEfficiency!,
      budget: b.scores!.budget ?? 0,
      color: b.priority ? PRIORITY_TOKEN[b.priority] : "var(--color-ink-faint)",
    }));

  const ranked = [...scored]
    .map((b) => ({ b, score: leadScore(b) }))
    .filter((r) => r.score != null)
    .sort((a, b) => (b.score! - a.score!))
    .slice(0, 12);

  return (
    <div className="space-y-8">
      <Reveal>
        <div className="eyebrow mb-2">Model</div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Scoring model</h1>
        <p className="mt-1 max-w-2xl text-[var(--color-ink-muted)]">
          Six sub-scores roll up into <strong>Economical Efficiency</strong> (budget · customization ·
          tempo) and <strong>Ease of Access</strong> (accessibility · alignment · receptivity).
        </p>
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
            <h2 className="mb-4 font-display text-lg font-semibold">Priority quadrant</h2>
            <PriorityQuadrant points={points} />
          </div>
        </Reveal>

        <Reveal>
          <div className="glass p-6">
            <h2 className="mb-4 font-display text-lg font-semibold">Top-ranked leads</h2>
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
