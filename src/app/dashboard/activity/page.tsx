import { redirect } from "next/navigation";
import { Reveal } from "@/components/Reveal";
import { getSessionUser } from "@/lib/auth/guards";
import { can } from "@/lib/auth/authorize";
import { getAuditStore } from "@/lib/store/audit";
import { relativeTime } from "@/lib/time";
import { ExportMenu } from "@/components/ExportMenu";

export const dynamic = "force-dynamic";

/** Colour an entry by its action namespace. */
function toneFor(action: string): string {
  if (action.startsWith("brand.")) return "var(--color-cyan)";
  if (action.startsWith("user.")) return "var(--color-brand)";
  if (action.startsWith("outreach.")) return "var(--color-amber)";
  if (action.startsWith("status.")) return "var(--color-mint)";
  return "var(--color-ink-faint)";
}

export default async function ActivityPage() {
  const me = await getSessionUser();
  if (!me) redirect("/login");
  if (!(await can("audit:read"))) redirect("/dashboard");

  const entries = await getAuditStore().list(200);

  return (
    <div className="space-y-8">
      <Reveal>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow mb-2">Audit trail</div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Activity</h1>
            <p className="mt-1 text-[var(--color-ink-muted)]">
              Every change, who made it and when - {entries.length} recent {entries.length === 1 ? "event" : "events"}.
            </p>
          </div>
          {entries.length > 0 && (
            <ExportMenu
              filename="activity"
              columns={[
                { key: "at", label: "When" },
                { key: "actorName", label: "Actor" },
                { key: "action", label: "Action" },
                { key: "entity", label: "Entity" },
                { key: "entityId", label: "Entity id" },
                { key: "summary", label: "Summary" },
              ]}
              rows={entries as unknown as Record<string, unknown>[]}
            />
          )}
        </div>
      </Reveal>

      <Reveal>
        <div className="glass p-6">
          {entries.length === 0 ? (
            <p className="text-sm text-[var(--color-ink-muted)]">No activity recorded yet.</p>
          ) : (
            <ol className="relative space-y-5 before:absolute before:left-[5px] before:top-1 before:h-full before:w-px before:bg-[var(--color-border)]">
              {entries.map((e) => (
                <li key={e.id} className="relative flex gap-4 pl-6">
                  <span
                    className="absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full ring-4 ring-[var(--color-absolute-zero)]"
                    style={{ background: toneFor(e.action) }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-sm text-[var(--color-ink)]">{e.summary}</span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
                        {e.action}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                      {e.actorName} - <time dateTime={e.at} title={e.at}>{relativeTime(e.at)}</time>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Reveal>
    </div>
  );
}
