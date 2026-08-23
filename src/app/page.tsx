import { TopBar } from "@/components/TopBar";
import { Reveal } from "@/components/Reveal";
import { KpiCard } from "@/components/KpiCard";
import { Hero } from "@/components/landing/Hero";
import { SmoothScrollProvider } from "@/lib/gsap/SmoothScrollProvider";
import { getDataset } from "@/lib/data";
import { weightedValue } from "@/lib/scoring";
import { openLeads } from "@/lib/lifecycle";

export default function Home() {
  const ds = getDataset();
  const brands = ds.brands;
  const scored = brands.filter((b) => b.scored && b.scores);
  const closed = brands.filter((b) => b.status === "Deal Closed").length;
  const weighted = openLeads(brands).reduce((sum, b) => sum + weightedValue(b), 0);
  // "In play" means still open — a won or lost deal is not in play.
  const totalBudget = openLeads(scored).reduce((s, b) => s + (b.scores?.budget ?? 0), 0);

  const features = [
    { title: "Pipeline & CRM", body: "Every lead, owner, stage and follow-up — live, filterable, editable.", tag: "Trackers" },
    { title: "Lead scoring", body: "The workbook's hidden model, rebuilt: what a deal is worth against how likely it is to close.", tag: "Quadrant" },
    { title: "Industry heat-map", body: "Segment scorecards fused with the sales playbook for each vertical.", tag: "Strategy" },
    { title: "Whitespace / TAM", body: "Approached vs addressable EU market — see where the room actually is.", tag: "Opportunity" },
    { title: "Data quality", body: "Naming, dates and taxonomy fixed on import, with a full audit trail.", tag: "Console" },
    { title: "AI copilot", body: "Chat with the data, reason across tasks and pull real-time context.", tag: "Foundry" },
  ];

  return (
    <>
      <TopBar fixed />

      <SmoothScrollProvider>
        {/* ---------------- HERO ---------------- */}
        <Hero leadCount={brands.length} />

        {/* KPI strip */}
        <section className="mx-auto max-w-7xl px-6 pb-16">
          <Reveal>
            <p className="eyebrow mb-5">
              <strong>Snapshot</strong> · {ds.meta.snapshotDate}
            </p>
          </Reveal>
          <Reveal stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Pipeline leads" value={brands.length} hint={`${scored.length} fully scored`} />
            <KpiCard
              label="Weighted value"
              value={weighted}
              format="eur"
              hint="open deals, probability-adjusted"
              accent="var(--color-cyan)"
            />
            <KpiCard label="Deals closed" value={closed} hint="won this cycle" accent="var(--color-mint)" />
            <KpiCard
              label="Budget in play"
              value={totalBudget}
              format="eur"
              hint={`${ds.industries.length} industries`}
              accent="var(--color-amber)"
            />
          </Reveal>
        </section>

        <div className="hairline mx-auto h-px max-w-7xl" />

        {/* ---------------- FEATURES ---------------- */}
        <section className="mx-auto max-w-7xl px-6 py-20">
          <Reveal>
            <p className="eyebrow mb-4">
              <strong>The platform</strong> · six lenses
            </p>
            <h2 className="max-w-3xl font-display text-3xl font-semibold tracking-tight md:text-5xl">
              Six lenses on <span className="text-gradient">one dataset.</span>
            </h2>
            <p className="mt-4 max-w-2xl text-[var(--color-ink-muted)]">
              Everything below is derived from the real data — no mock-ups.
            </p>
          </Reveal>

          <Reveal stagger className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="beam-card glass group p-6 transition-transform duration-300 ease-[var(--ease-brand-snap)] hover:-translate-y-1.5"
              >
                <div className="eyebrow text-[var(--color-brand-bright)]">{f.tag}</div>
                <h3 className="mt-3 font-display text-xl font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">{f.body}</p>
              </div>
            ))}
          </Reveal>
        </section>

        <footer className="border-t border-[var(--color-border)] py-10">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 text-sm text-[var(--color-ink-faint)] md:flex-row">
            <span>OOVIE Studios · Business Development Intelligence</span>
            <span>Snapshot {ds.meta.snapshotDate} · Next.js on Azure</span>
          </div>
        </footer>
      </SmoothScrollProvider>
    </>
  );
}
