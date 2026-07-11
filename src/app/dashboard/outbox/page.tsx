import { redirect } from "next/navigation";
import { Reveal } from "@/components/Reveal";
import { OutreachItem } from "@/components/OutreachItem";
import { getSessionUser } from "@/lib/auth/guards";
import { getOutreachStore, type OutreachStatus } from "@/lib/store/outreach";
import { ExportMenu } from "@/components/ExportMenu";

export const dynamic = "force-dynamic";

const COUNTS: { status: OutreachStatus; label: string; accent: string }[] = [
  { status: "pending_approval", label: "Awaiting approval", accent: "var(--color-amber)" },
  { status: "draft", label: "Drafts", accent: "var(--color-ink-muted)" },
  { status: "sent", label: "Sent", accent: "var(--color-mint)" },
  { status: "failed", label: "Failed", accent: "var(--color-rose)" },
];

export default async function OutboxPage() {
  const me = await getSessionUser();
  if (!me) redirect("/login");
  const isAdmin = me.role === "admin";

  const all = await getOutreachStore().list(300);
  const count = (s: OutreachStatus) => all.filter((o) => o.status === s).length;

  return (
    <div className="space-y-8">
      <Reveal>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow mb-2">Actions</div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Outbox</h1>
            <p className="mt-1 text-[var(--color-ink-muted)]">
              Templated outreach — {isAdmin ? "review, approve and send." : "draft and submit for an admin to send."}
            </p>
          </div>
          {all.length > 0 && (
            <ExportMenu
              filename="outbox"
              columns={[
                { key: "brandName", label: "Lead" },
                { key: "to", label: "To" },
                { key: "subject", label: "Subject" },
                { key: "status", label: "Status" },
                { key: "provider", label: "Provider" },
                { key: "createdByName", label: "Created by" },
                { key: "createdAt", label: "Created" },
              ]}
              rows={all.map((o) => ({
                brandName: o.brandName,
                to: o.to,
                subject: o.subject,
                status: o.status,
                provider: o.provider ?? null,
                createdByName: o.createdByName,
                createdAt: o.createdAt,
              }))}
            />
          )}
        </div>
      </Reveal>

      <Reveal stagger className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {COUNTS.map((c) => (
          <div key={c.status} className="glass relative overflow-hidden p-5">
            <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${c.accent}, transparent)` }} />
            <div className="eyebrow">{c.label}</div>
            <div className="mt-2 font-display text-3xl font-semibold tabular-nums">{count(c.status)}</div>
          </div>
        ))}
      </Reveal>

      <Reveal>
        <section className="glass p-6">
          {all.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--color-ink-muted)]">
              No outreach yet. Open a lead and hit <span className="text-[var(--color-ink)]">Reach out</span> to draft one.
            </p>
          ) : (
            <div>
              {all.map((o) => (
                <OutreachItem key={o.id} o={o} isAdmin={isAdmin} meId={me.id} showBrand />
              ))}
            </div>
          )}
        </section>
      </Reveal>
    </div>
  );
}
