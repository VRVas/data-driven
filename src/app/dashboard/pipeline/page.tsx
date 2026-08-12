import { Reveal } from "@/components/Reveal";
import { BrandTable } from "@/components/BrandTable";
import { KpiCard } from "@/components/KpiCard";
import { getVisibleBrands } from "@/lib/leads/visible";
import { getSessionUser } from "@/lib/auth/guards";
import { can } from "@/lib/auth/authorize";
import { getViewStore } from "@/lib/store/views";
import { getCrmGraph } from "@/lib/crm/graph";
import { pipelineHealth, withHealth, type LeadHealth } from "@/lib/pipeline/health";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const [brands, graph] = await Promise.all([getVisibleBrands(), getCrmGraph()]);
  const me = await getSessionUser();
  const isAdmin = await can("lead:delete");
  const views = me ? await getViewStore().listForUser(me.id) : [];

  const health = pipelineHealth(brands, graph.proposals);
  const byLead: Record<string, LeadHealth> = Object.fromEntries(
    withHealth(brands, graph.proposals).map((r) => [r.brand.id, r.health]),
  );

  return (
    <div className="space-y-6">
      <Reveal>
        <div className="eyebrow mb-2">Lead tracker</div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Pipeline</h1>
        <p className="mt-1 text-[var(--color-ink-muted)]">
          Who owes the next move, and who is late making it. Search, filter, sort and edit below.
        </p>
      </Reveal>

      <Reveal stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Late on us" value={health.lateOnUs} hint="we owe them a reply" accent="var(--color-rose)" />
        <KpiCard label="Late on them" value={health.lateOnThem} hint="overdue a chase" accent="var(--color-amber)" />
        <KpiCard
          label="Awaiting greenlight"
          value={health.awaitingGreenlightEur}
          format="eur"
          hint="sent, no answer yet"
          accent="var(--color-cyan)"
        />
        <KpiCard
          label="Needs an owner"
          value={health.untriaged}
          hint={`of ${health.open} open · ${health.stale} gone quiet`}
          accent="var(--color-ink-faint)"
        />
      </Reveal>

      <Reveal>
        <div className="glass p-6">
          <BrandTable brands={brands} health={byLead} canDelete={isAdmin} views={views} />
        </div>
      </Reveal>
    </div>
  );
}
