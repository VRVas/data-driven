import { Reveal } from "@/components/Reveal";
import { KpiCard } from "@/components/KpiCard";
import { ChartCard } from "@/components/ChartCard";
import { WhitespaceBars } from "@/components/viz/WhitespaceBars";
import { OpportunityMap } from "@/components/viz/OpportunityMap";
import { MarketSizingBars } from "@/components/viz/MarketSizingBars";
import { getDataset, getLiveIndustries } from "@/lib/data";
import { rankByOpportunity, whitespace as whitespaceOf, penetration as penetrationOf, opportunityScore } from "@/lib/tam";
import { ExportMenu } from "@/components/ExportMenu";

export const dynamic = "force-dynamic";

export default async function WhitespacePage() {
  const ds = getDataset();
  const industries = await getLiveIndustries();

  const addressable = industries.reduce((s, i) => s + (i.companiesEU ?? 0), 0);
  const approached = industries.reduce((s, i) => s + i.opened, 0);
  const penetration = addressable ? approached / addressable : 0;
  const untapped = addressable - approached;
  const ranked = rankByOpportunity(industries);
  const topPick = ranked[0];

  return (
    <div className="space-y-8">
      <Reveal>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Whitespace &amp; TAM</h1>
            <p className="mt-1 max-w-2xl text-[var(--color-ink-muted)]">
              Approached vs addressable market across the EU. The room to grow is the space
              the bars <em>don&apos;t</em> fill - weighted by how valuable each segment is.
            </p>
          </div>
          <ExportMenu
            filename="whitespace-tam"
            columns={[
              { key: "industry", label: "Industry" },
              { key: "valuation", label: "Valuation" },
              { key: "addressable", label: "Addressable (EU)" },
              { key: "approached", label: "Approached" },
              { key: "untapped", label: "Untapped" },
              { key: "penetration", label: "Penetration %" },
              { key: "opportunityScore", label: "Opportunity score" },
            ]}
            rows={ranked.map((i) => ({
              industry: i.name,
              valuation: i.valuation,
              addressable: i.companiesEU,
              approached: i.opened,
              untapped: whitespaceOf(i.opened, i.companiesEU),
              penetration: penetrationOf(i.opened, i.companiesEU) != null ? Math.round((penetrationOf(i.opened, i.companiesEU) ?? 0) * 100) : null,
              opportunityScore: opportunityScore(i),
            }))}
          />
        </div>
      </Reveal>

      <Reveal stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Addressable (EU)" value={addressable} hint="companies in scope" />
        <KpiCard label="Approached" value={approached} accent="var(--color-mint)" hint="opened so far" />
        <KpiCard label="Penetration" value={Math.round(penetration * 100)} format="percent" accent="var(--color-amber)" hint="of the market" />
        <KpiCard label="Untapped" value={untapped} accent="var(--color-cyan)" hint={topPick ? `top pick: ${topPick.name}` : undefined} />
      </Reveal>

      <Reveal>
        <ChartCard id="ws-bars" title="Whitespace by industry" subtitle="Ranked by opportunity (value × untapped share) - fill = share approached">
          <WhitespaceBars industries={ranked} />
        </ChartCard>
      </Reveal>

      <div className="grid gap-6 lg:grid-cols-2">
        <Reveal className="h-full">
          <ChartCard id="ws-map" title="Opportunity map" subtitle="Low penetration + high efficiency = prime whitespace - bubble = market size">
            <OpportunityMap industries={industries} />
          </ChartCard>
        </Reveal>
        <Reveal className="h-full">
          <ChartCard id="ws-restricted" title="Restricted / closed sectors" subtitle="Adjacent TAM not yet open - sized by market value (USD bn)">
            <MarketSizingBars sectors={ds.marketSizing} />
          </ChartCard>
        </Reveal>
      </div>
    </div>
  );
}
