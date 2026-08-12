import Link from "next/link";
import { notFound } from "next/navigation";
import { Reveal } from "@/components/Reveal";
import { Badge } from "@/components/Badge";
import { EditBrandButton } from "@/components/EditBrandButton";
import { QuickStatus } from "@/components/QuickStatus";
import { OutreachComposer } from "@/components/OutreachComposer";
import { OutreachItem } from "@/components/OutreachItem";
import { LeadToolbar } from "@/components/LeadToolbar";
import { LinkCompanyButton } from "@/components/crm/LinkCompanyButton";
import { getBrand } from "@/lib/data";
import { getCrmGraph, getDealWithCompany } from "@/lib/crm/graph";
import { ownerIdResolver } from "@/lib/crm/owners";
import { getSessionUser } from "@/lib/auth/guards";
import { can, requirePermission } from "@/lib/auth/authorize";
import { getOutreachStore } from "@/lib/store/outreach";
import { allowedTransitions } from "@/lib/workflow";
import {
  STATUS_TOKEN,
  PRIORITY_TOKEN,
  leadScore,
  effectiveScores,
  effectiveTempoMonths,
  quadrant,
  weightedValue,
  winProbability,
  eur,
} from "@/lib/scoring";
import { healthOf, WAITING_LABEL } from "@/lib/pipeline/health";
import { budgetVariance } from "@/lib/pipeline/budget";
import type { BrandStatus, Priority } from "@/lib/types";

export const dynamic = "force-dynamic";

const SUB_SCORES: { key: keyof NonNullable<import("@/lib/types").Brand["scores"]>; label: string }[] = [
  { key: "tempoScore", label: "Tempo (freshness)" },
  { key: "budgetScore", label: "Budget" },
  { key: "customizationScore", label: "Customization" },
  { key: "accessibilityScore", label: "Accessibility" },
  { key: "receptivityScore", label: "Receptivity" },
  { key: "alignmentScore", label: "Alignment" },
];

const TIMELINE: { key: "initialContact" | "lastContact" | "followUpDate" | "closingFailed"; label: string }[] = [
  { key: "initialContact", label: "Initial contact" },
  { key: "lastContact", label: "Last contact" },
  { key: "followUpDate", label: "Follow up" },
  { key: "closingFailed", label: "Closing / failed" },
];

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requirePermission("lead:read");
  const brand = await getBrand(id);
  if (!brand) notFound();
  // Out of scope reads as "not found" rather than confirming the lead exists.
  if (!auth.superuser && auth.scope !== "all") {
    const resolveOwner = await ownerIdResolver();
    if (resolveOwner(brand.owner) !== auth.user.id) notFound();
  }
  const me = await getSessionUser();
  const isAdmin = await can("outreach:send");
  const canDeleteLead = await can("lead:delete");
  const canLinkCompany = await can("lead:update");
  const outreach = await getOutreachStore().listForBrand(brand.id);

  const [crm, graph] = await Promise.all([getDealWithCompany(brand.id), getCrmGraph()]);
  const dealsPerCompany = graph.deals.reduce<Map<string, number>>(
    (counts, d) => counts.set(d.companyId, (counts.get(d.companyId) ?? 0) + 1),
    new Map(),
  );
  const companyChoices = graph.companies.map((c) => ({
    id: c.id,
    name: c.name,
    dealCount: dealsPerCompany.get(c.id) ?? 0,
  }));

  const s = effectiveScores(brand);
  const score = leadScore(brand);
  const health = healthOf(brand, crm?.proposals ?? []);
  const tempo = effectiveTempoMonths(brand);
  const variance = budgetVariance(brand);
  const q = s?.economicalEfficiency != null && s?.easeOfAccess != null
    ? quadrant(s.economicalEfficiency, s.easeOfAccess)
    : null;

  return (
    <div className="space-y-8">
      <Reveal>
        <Link href="/dashboard/pipeline" className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
          ← Pipeline
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl font-semibold tracking-tight">{brand.name}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {brand.status && <Badge color={STATUS_TOKEN[brand.status as BrandStatus]}>{brand.status}</Badge>}
              {brand.priority && <Badge color={PRIORITY_TOKEN[brand.priority as Priority]}>{brand.priority}</Badge>}
              {brand.industry && <Badge>{brand.industry}</Badge>}
              {!brand.scored && <span className="text-xs text-[var(--color-ink-faint)]">unscored</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <OutreachComposer brand={brand} senderName={me?.name ?? "there"} isAdmin={isAdmin} />
            <EditBrandButton brand={brand} canDelete={canDeleteLead} />
            <LeadToolbar brand={brand} />
          </div>
        </div>
      </Reveal>

      {/* headline metrics */}
      <Reveal stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Lead score" value={score != null ? score.toFixed(2) : "—"} accent="var(--color-brand)" />
        <Metric label="Quadrant" value={q ?? "—"} accent="var(--color-cyan)" />
        <Metric label="Budget" value={s?.budget ? eur(s.budget) : "—"} accent="var(--color-amber)" />
        <Metric
          label="Weighted value"
          value={eur(weightedValue(brand))}
          hint={`${Math.round(winProbability(brand.status) * 100)}% win prob.`}
          accent="var(--color-mint)"
        />
      </Reveal>
      <Reveal>
        <section className="glass p-5">
          <div className="eyebrow mb-2">Pipeline stage</div>
          <QuickStatus brandId={brand.id} current={brand.status} allowed={allowedTransitions(brand.status)} />
        </section>
      </Reveal>

      <Reveal>
        <section className="glass p-6">
          <div className="eyebrow mb-3">Next move &amp; pace</div>
          <dl className="grid gap-5 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-[var(--color-ink-muted)]">Waiting on</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
                {health.waitingOn ? (
                  <>
                    <Badge color={health.waitingOn === "us" ? "var(--color-brand)" : "var(--color-ink-faint)"}>
                      {WAITING_LABEL[health.waitingOn]}
                    </Badge>
                    {health.daysLate > 0 && (
                      <span
                        className="text-sm font-medium tabular-nums"
                        style={{ color: health.waitingOn === "us" ? "var(--color-rose)" : "var(--color-amber)" }}
                      >
                        {health.daysLate}d late
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-[var(--color-ink-faint)]">nobody yet</span>
                )}
              </dd>
              {brand.nextStep && (
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{brand.nextStep}</p>
              )}
            </div>

            <div>
              <dt className="text-sm text-[var(--color-ink-muted)]">
                {tempo.basis === "actual" ? "Took" : "Expected to take"}
              </dt>
              <dd className="mt-1 font-display text-xl font-semibold tabular-nums">
                {tempo.months == null ? "—" : `${tempo.months.toFixed(1)} months`}
              </dd>
              <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                {tempo.basis === "actual"
                  ? "measured from first contact to close"
                  : tempo.months == null
                    ? "no estimate yet"
                    : "estimated at open"}
              </p>
            </div>

            <div>
              <dt className="text-sm text-[var(--color-ink-muted)]">Budget</dt>
              <dd className="mt-1 font-display text-xl font-semibold tabular-nums">
                {s?.budget == null ? "—" : eur(s.budget)}
              </dd>
              <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                {variance ? (
                  <>
                    accepted vs {eur(variance.estimated)} estimated{" "}
                    <span style={{ color: variance.deltaEur >= 0 ? "var(--color-mint)" : "var(--color-rose)" }}>
                      ({variance.deltaEur >= 0 ? "+" : ""}
                      {variance.deltaPct == null ? eur(variance.deltaEur) : `${Math.round(variance.deltaPct)}%`})
                    </span>
                  </>
                ) : s?.budget == null ? (
                  "not set yet"
                ) : s.assumption === "Confirmed" ? (
                  "confirmed"
                ) : (
                  "estimated at open"
                )}
              </p>
            </div>
          </dl>
        </section>
      </Reveal>
      {crm && (
        <Reveal>
          <section className="glass flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="min-w-0">
              <div className="eyebrow mb-1">Company</div>
              <Link
                href={`/dashboard/companies/${crm.company.id}`}
                className="font-display text-lg font-semibold hover:text-[var(--color-brand)]"
              >
                {crm.company.name}
              </Link>
              {(dealsPerCompany.get(crm.company.id) ?? 0) > 1 && (
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                  {dealsPerCompany.get(crm.company.id)} deals · {eur(crm.company.rollup.lifetimeValue)} lifetime
                </p>
              )}
            </div>
            {canLinkCompany && (
              <LinkCompanyButton
                deal={{
                  id: crm.deal.id,
                  name: crm.deal.name,
                  companyId: crm.company.id,
                  isLinked: graph.links.some((l) => l.dealId === crm.deal.id),
                }}
                companies={companyChoices}
              />
            )}
          </section>
        </Reveal>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* score breakdown */}
        <Reveal>
          <section className="glass p-6">
            <h2 className="mb-5 font-display text-lg font-semibold">Score breakdown</h2>
            {s ? (
              <div className="space-y-3">
                {SUB_SCORES.map(({ key, label }) => (
                  <ScoreRow key={key} label={label} value={s[key] as number | null} />
                ))}
                <div className="mt-4 grid grid-cols-2 gap-4 border-t border-[var(--color-border)] pt-4">
                  <Aggregate label="Economical efficiency" value={s.economicalEfficiency} />
                  <Aggregate label="Ease of access" value={s.easeOfAccess} />
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-ink-muted)]">
                This lead hasn&apos;t been scored yet. Add budget, tempo and the rubric scores to see it on the quadrant.
              </p>
            )}
          </section>
        </Reveal>

        {/* contact + timeline */}
        <Reveal>
          <section className="glass p-6">
            <h2 className="mb-5 font-display text-lg font-semibold">Relationship</h2>
            <dl className="space-y-3 text-sm">
              <Row label="Owner" value={brand.owner} />
              <Row label="Point of contact" value={brand.poc} />
            </dl>
            <div className="mt-6">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">Timeline</h3>
              <ol className="space-y-3">
                {TIMELINE.map(({ key, label }) => (
                  <li key={key} className="flex items-center gap-3">
                    <span className={`h-2 w-2 rounded-full ${brand[key] ? "bg-[var(--color-brand)]" : "bg-[var(--color-border-strong)]"}`} />
                    <span className="w-32 text-[var(--color-ink-muted)]">{label}</span>
                    <span className="tabular-nums">{brand[key] ?? "—"}</span>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </Reveal>
      </div>

      {brand.notes && (
        <Reveal>
          <section className="glass p-6">
            <h2 className="mb-3 font-display text-lg font-semibold">Notes</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink-muted)]">{brand.notes}</p>
          </section>
        </Reveal>
      )}

      {outreach.length > 0 && (
        <Reveal>
          <section className="glass p-6">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-display text-lg font-semibold">Outreach</h2>
              <span className="text-xs text-[var(--color-ink-faint)]">
                {outreach.length} message{outreach.length === 1 ? "" : "s"}
              </span>
            </div>
            <div>
              {outreach.map((o) => (
                <OutreachItem key={o.id} o={o} isAdmin={isAdmin} meId={me?.id ?? ""} />
              ))}
            </div>
          </section>
        </Reveal>
      )}
    </div>
  );
}

function Metric({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div className="glass relative overflow-hidden p-5">
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent ?? "var(--color-brand)"}, transparent)` }} />
      <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">{label}</div>
      <div className="mt-2 font-display text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-sm text-[var(--color-ink-muted)]">{hint}</div>}
    </div>
  );
}

function ScoreRow({ label, value }: { label: string; value: number | null }) {
  const pct = value != null ? (value / 5) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-[var(--color-ink-muted)]">{label}</span>
        <span className="tabular-nums">{value != null ? value.toFixed(1) : "—"}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface)]">
        <div className="h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Aggregate({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-[var(--color-ink-faint)]">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold">{value != null ? value.toFixed(2) : "—"}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-[var(--color-ink-faint)]">{label}</dt>
      <dd className="text-right">{value ?? "—"}</dd>
    </div>
  );
}
