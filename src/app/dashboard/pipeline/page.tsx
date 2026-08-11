import { Reveal } from "@/components/Reveal";
import { BrandTable } from "@/components/BrandTable";
import { getBrands } from "@/lib/data";
import { getSessionUser } from "@/lib/auth/guards";
import { can, requirePermission } from "@/lib/auth/authorize";
import { ownerIdResolver } from "@/lib/crm/owners";
import { getViewStore } from "@/lib/store/views";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const auth = await requirePermission("lead:read");
  const all = await getBrands();
  // A capability alone doesn't grant access to every row.
  const resolveOwner = await ownerIdResolver();
  const brands =
    auth.superuser || auth.scope === "all"
      ? all
      : all.filter((b) => resolveOwner(b.owner) === auth.user.id);
  const me = await getSessionUser();
  const isAdmin = await can("lead:delete");
  const views = me ? await getViewStore().listForUser(me.id) : [];
  return (
    <div className="space-y-6">
      <Reveal>
        <div className="eyebrow mb-2">Lead tracker</div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Pipeline</h1>
        <p className="mt-1 text-[var(--color-ink-muted)]">
          The full lead tracker — search, filter, sort and edit. Create leads, update
          stages and owners, or remove them. One-click outreach lands next.
        </p>
      </Reveal>
      <Reveal>
        <div className="glass p-6">
          <BrandTable brands={brands} canDelete={isAdmin} views={views} />
        </div>
      </Reveal>
    </div>
  );
}
