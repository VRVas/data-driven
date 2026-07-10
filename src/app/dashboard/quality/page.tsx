import { Reveal } from "@/components/Reveal";
import { getDataQuality } from "@/lib/data";

export default function QualityPage() {
  const { issues, count } = getDataQuality();
  const groups = issues.reduce<Record<string, typeof issues>>((acc, i) => {
    const bucket = i.issue.includes("date") || i.key.includes("Contact")
      ? "Dates"
      : i.issue.includes("POC")
        ? "Types"
        : i.issue.includes("join")
          ? "Joins"
          : "Other";
    (acc[bucket] ??= []).push(i);
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      <Reveal>
        <div className="eyebrow mb-2">Data audit</div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Data quality</h1>
        <p className="mt-1 text-[var(--color-ink-muted)]">
          {count} issues detected and resolved during migration — full audit trail.
        </p>
      </Reveal>

      <Reveal stagger className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Object.entries(groups).map(([g, list]) => (
          <div key={g} className="glass p-5">
            <div className="eyebrow">{g}</div>
            <div className="mt-1 font-display text-3xl font-semibold">{list.length}</div>
          </div>
        ))}
      </Reveal>

      <Reveal>
        <div className="glass overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface)]">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">Entity</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">Field</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">Issue</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">Resolution</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((i, idx) => (
                <tr key={idx} className="border-t border-[var(--color-border)]">
                  <td className="px-4 py-2.5 font-medium">{i.entity}</td>
                  <td className="px-4 py-2.5 text-[var(--color-ink-muted)]">{i.key}</td>
                  <td className="px-4 py-2.5 text-[var(--color-ink-muted)]">{i.issue}</td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-full bg-[color-mix(in_srgb,var(--color-mint)_14%,transparent)] px-2 py-0.5 text-xs text-[var(--color-mint)]">
                      {i.fix}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>
    </div>
  );
}
