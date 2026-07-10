import { Reveal } from "@/components/Reveal";
import { BrandTable } from "@/components/BrandTable";
import { getBrands } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const brands = await getBrands();
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
          <BrandTable brands={brands} />
        </div>
      </Reveal>
    </div>
  );
}
