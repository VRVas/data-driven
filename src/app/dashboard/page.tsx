import { Reveal } from "@/components/Reveal";
import { KpiCard } from "@/components/KpiCard";
import { StatusPill } from "@/components/ui/StatusPill";
import { StatusFunnel, type FunnelRow } from "@/components/viz/StatusFunnel";
import { IndustryHeatmap } from "@/components/viz/IndustryHeatmap";
import { PriorityQuadrant, type QuadPoint } from "@/components/viz/PriorityQuadrant";
import { getDataset, getBrands } from "@/lib/data";
import { STATUS_TOKEN, PRIORITY_TOKEN, weightedValue } from "@/lib/scoring";
import type { BrandStatus } from "@/lib/types";

// Reads the live brand store — render per request (never prerender at build).
export const dynamic = "force-dynamic";

const STATUS_ORDER: BrandStatus[] = [
  "Deal Closed",
  "Advanced",
  "Follow Up",
  "Early",
  "Back to Attack",
  "Recurring",
  "Still to open",
  "Did not work out",
];

function Panel({ eyebrow, title, subtitle, children, className, tour }: { eyebrow?: string; title: string; subtitle?: string; children: React.ReactNode; className?: string; tour?: string }) {
  return (
    <section data-tour={tour} className={`glass p-6 ${className ?? ""}`}>
      <div className="mb-5">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export default async function DashboardOverview() {
  const ds = getDataset();
  const brands = await getBrands();
  const scored = brands.filter((b) => b.scored && b.scores);

  const closed = brands.filter((b) => b.status === "Deal Closed").length;
  const weighted = brands.reduce((s, b) => s + weightedValue(b), 0);
  const hot = brands.filter((b) => b.priority === "Hot Lead").length;

  const funnel: FunnelRow[] = STATUS_ORDER.map((s) => ({
    label: s,
    value: brands.filter((b) => b.status === s).length,
    color: STATUS_TOKEN[s],
  })).filter((r) => r.value > 0);

  const industries = [...ds.industries].sort(
    (a, b) => (b.economicalEfficiency ?? 0) - (a.economicalEfficiency ?? 0),
  );

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

  return (
    <div className="space-y-8">
      <Reveal>
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="eyebrow mb-2">Command center</div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Overview</h1>
            <p className="mt-1 text-[var(--color-ink-muted)]">
              {brands.length} leads · {scored.length} scored · snapshot {ds.meta.snapshotDate}
            </p>
          </div>
          <StatusPill label="Live data" />
        </div>
      </Reveal>

      <div data-tour="kpis">
        <Reveal stagger className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiCard label="Total pipeline" value={brands.length} hint={`${hot} hot leads`} />
          <KpiCard label="Weighted value" value={weighted} format="eur" accent="var(--color-cyan)" hint="probability-adjusted" />
          <KpiCard label="Deals closed" value={closed} accent="var(--color-mint)" hint="won" />
          <KpiCard label="Scored coverage" value={Math.round((scored.length / brands.length) * 100)} format="percent" accent="var(--color-amber)" hint={`${brands.length - scored.length} unscored`} />
        </Reveal>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Reveal>
          <Panel eyebrow="Funnel" title="Pipeline by stage" subtitle="Lead count across the sales funnel" tour="funnel">
            <StatusFunnel rows={funnel} />
          </Panel>
        </Reveal>

        <Reveal>
          <Panel eyebrow="Targeting" title="Priority quadrant" subtitle="Economical efficiency × ease of access · bubble = budget" tour="quadrant">
            <PriorityQuadrant points={points} />
          </Panel>
        </Reveal>
      </div>

      <Reveal>
        <Panel eyebrow="Segments" title="Industry scorecard" subtitle="Segment-level model, recomputed from the raw data" tour="heatmap">
          <IndustryHeatmap industries={industries} />
        </Panel>
      </Reveal>
    </div>
  );
}
