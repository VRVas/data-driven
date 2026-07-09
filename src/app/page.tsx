import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { Reveal } from "@/components/Reveal";
import { KpiCard } from "@/components/KpiCard";
import { getDataset } from "@/lib/data";
import { weightedValue } from "@/lib/scoring";

export default function Home() {
  const ds = getDataset();
  const brands = ds.brands;
  const scored = brands.filter((b) => b.scored && b.scores);
  const closed = brands.filter((b) => b.status === "Deal Closed").length;
  const weighted = brands.reduce((sum, b) => sum + weightedValue(b), 0);
  const totalBudget = scored.reduce((s, b) => s + (b.scores?.budget ?? 0), 0);

  const features = [
    { title: "Pipeline & CRM", body: "Every lead, owner, stage and follow-up — live, filterable, editable.", tag: "Trackers" },
    { title: "Lead scoring", body: "The workbook's hidden model, re-computed: value-efficiency × ease-of-access.", tag: "Quadrant" },
    { title: "Industry heat-map", body: "Segment scorecards fused with the sales playbook for each vertical.", tag: "Strategy" },
    { title: "Whitespace / TAM", body: "Approached vs addressable EU market — see where the room actually is.", tag: "Opportunity" },
    { title: "Data quality", body: "Naming, dates and taxonomy fixed on import, with a full audit trail.", tag: "Console" },
    { title: "AI copilot", body: "Chat with the data, reason across tasks and pull real-time context.", tag: "Foundry" },
  ];

  return (
    <>
      <TopBar />

      {/* ---------------- HERO ---------------- */}
      <section className="relative mx-auto max-w-7xl px-6 pt-20 pb-16 md:pt-28">
        <Reveal>
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1 text-xs text-[var(--color-ink-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-mint)]" />
            OOVIE Studios · Business Development
          </span>
        </Reveal>

        <Reveal delay={0.05}>
          <h1 className="mt-6 max-w-4xl font-display text-5xl font-semibold leading-[1.02] tracking-tight md:text-7xl">
            Your client segmentation,
            <br />
            <span className="text-gradient">turned into an operating system.</span>
          </h1>
        </Reveal>

        <Reveal delay={0.1}>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[var(--color-ink-muted)]">
            A static spreadsheet held {brands.length} leads, a hidden scoring engine and a
            full sales playbook. We turned it into a living, interactive intelligence
            platform — scored, segmented and ready to act on.
          </p>
        </Reveal>

        <Reveal delay={0.15}>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard"
              className="rounded-full bg-[var(--color-brand)] px-6 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow)] transition-transform hover:scale-[1.03]"
            >
              Enter the platform →
            </Link>
            <Link
              href="/dashboard/scoring"
              className="rounded-full border border-[var(--color-border-strong)] px-6 py-3 text-sm font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface)]"
            >
              See the scoring model
            </Link>
          </div>
        </Reveal>

        {/* KPI strip */}
        <Reveal stagger className="mt-16 grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiCard label="Pipeline leads" value={brands.length} hint={`${scored.length} fully scored`} />
          <KpiCard
            label="Weighted value"
            value={weighted}
            format="eur"
            hint="probability-adjusted"
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
          <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
            Six lenses on one dataset.
          </h2>
          <p className="mt-3 max-w-2xl text-[var(--color-ink-muted)]">
            Everything below is derived from the real data — no mock-ups.
          </p>
        </Reveal>

        <Reveal stagger className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="glass group p-6 transition-transform hover:-translate-y-1">
              <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-brand-bright)]">
                {f.tag}
              </div>
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
    </>
  );
}
