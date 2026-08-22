import { Reveal } from "@/components/Reveal";
import { IndustryHeatmap } from "@/components/viz/IndustryHeatmap";
import { Badge } from "@/components/Badge";
import { getDataset, getLiveIndustries } from "@/lib/data";
import { valuationToken } from "@/lib/scoring";
import type { Industry } from "@/lib/types";
import { ExportMenu } from "@/components/ExportMenu";

export const dynamic = "force-dynamic";

export default async function IndustriesPage() {
  const ds = getDataset();
  const industries = (await getLiveIndustries()).sort(
    (a, b) => (b.economicalEfficiency ?? 0) - (a.economicalEfficiency ?? 0),
  );
  const playbook = new Map(ds.playbook.map((p) => [p.industry, p]));

  return (
    <div className="space-y-8">
      <Reveal>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow mb-2">Segments</div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Industries</h1>
            <p className="mt-1 text-[var(--color-ink-muted)]">
              Segment scorecard fused with the sales playbook for each vertical.
            </p>
          </div>
          <ExportMenu
            filename="industries"
            columns={[
              { key: "name", label: "Industry" },
              { key: "economicalEfficiency", label: "Econ. efficiency" },
              { key: "easeOfAccess", label: "Ease of access" },
              { key: "valuation", label: "Valuation" },
              { key: "companiesEU", label: "Companies (EU)" },
              { key: "approachedMarket", label: "Approached market" },
              { key: "opened", label: "Opened" },
              { key: "avgBudget", label: "Avg budget" },
              { key: "musicVideoFit", label: "Music+video fit" },
            ]}
            rows={industries.map((i) => ({
              name: i.name,
              economicalEfficiency: i.economicalEfficiency,
              easeOfAccess: i.easeOfAccess,
              valuation: i.valuation,
              companiesEU: i.companiesEU,
              approachedMarket: i.approachedMarket,
              opened: i.opened,
              avgBudget: i.avgBudget,
              musicVideoFit: i.musicVideoFit,
            }))}
          />
        </div>
      </Reveal>

      <Reveal>
        <div className="glass p-6">
          <IndustryHeatmap industries={industries} />
        </div>
      </Reveal>

      <Reveal stagger className="grid gap-4 md:grid-cols-2">
        {industries.map((ind) => {
          const p = playbook.get(ind.name as Industry);
          return (
            <div key={ind.name} className="glass p-6">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-xl font-semibold">{ind.name}</h3>
                {ind.valuation && (
                  <Badge color={valuationToken(ind.valuation)}>{ind.valuation}</Badge>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-[var(--color-ink-muted)]">
                <span>Opened <b className="text-[var(--color-ink)]">{ind.opened}</b>/{ind.companiesEU ?? "?"}</span>
                <span>Approached <b className="text-[var(--color-ink)]">{ind.approachedMarket != null ? `${(ind.approachedMarket * 100).toFixed(1)}%` : "—"}</b></span>
                {ind.avgBudget != null && <span>Avg budget <b className="text-[var(--color-ink)]">€{ind.avgBudget.toLocaleString()}</b></span>}
              </div>
              {p?.valueProposition && (
                <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink-muted)]">
                  <span className="font-medium text-[var(--color-ink)]">Value proposition · </span>
                  {p.valueProposition}
                </p>
              )}
              {p?.resistance && (
                <div className="mt-3 text-sm">
                  <span className="text-[var(--color-ink-faint)]">Receptivity: </span>
                  <span className="text-[var(--color-ink)]">{p.resistance}</span>
                </div>
              )}
            </div>
          );
        })}
      </Reveal>
    </div>
  );
}
