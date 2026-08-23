import { Reveal } from "@/components/Reveal";
import { ReminderRow } from "@/components/ReminderRow";
import { getVisibleBrands } from "@/lib/leads/visible";
import { followUpsFrom, type FollowUp, type FollowUpBucket } from "@/lib/leads/followups";
import { ExportMenu } from "@/components/ExportMenu";

export const dynamic = "force-dynamic";

const SECTIONS: { bucket: FollowUpBucket; title: string; blurb: string }[] = [
  { bucket: "overdue", title: "Overdue", blurb: "Past their follow-up date" },
  { bucket: "today", title: "Today", blurb: "Due today" },
  { bucket: "upcoming", title: "Upcoming", blurb: "Next 30 days" },
];

export default async function RemindersPage() {
  const brands = await getVisibleBrands();
  const reminders = followUpsFrom(brands);
  const byBucket = (b: FollowUpBucket): FollowUp[] => reminders.filter((r) => r.bucket === b);
  const dueCount = byBucket("overdue").length + byBucket("today").length;

  return (
    <div className="space-y-8">
      <Reveal>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow mb-2">Follow-ups</div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Reminders</h1>
            <p className="mt-1 text-[var(--color-ink-muted)]">
              {reminders.length === 0
                ? "Nothing on the radar - no open follow-ups scheduled."
                : `${dueCount} need attention - ${reminders.length} scheduled in the next 30 days.`}
            </p>
          </div>
          {reminders.length > 0 && (
            <ExportMenu
              filename="reminders"
              columns={[
                { key: "name", label: "Lead" },
                { key: "followUpDate", label: "Follow up" },
                { key: "bucket", label: "Bucket" },
                { key: "days", label: "Days" },
                { key: "owner", label: "Owner" },
              ]}
              rows={reminders.map((r) => ({ name: r.brand.name, followUpDate: r.date, bucket: r.bucket, days: r.days, owner: r.brand.owner }))}
            />
          )}
        </div>
      </Reveal>

      {SECTIONS.map(({ bucket, title, blurb }) => {
        const items = byBucket(bucket);
        if (items.length === 0) return null;
        return (
          <Reveal key={bucket}>
            <section className="glass p-6">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-display text-lg font-semibold">{title}</h2>
                <span className="text-xs text-[var(--color-ink-faint)]">
                  {items.length} - {blurb}
                </span>
              </div>
              <div>
                {items.map((r) => (
                  <ReminderRow key={r.brand.id} r={r} />
                ))}
              </div>
            </section>
          </Reveal>
        );
      })}

      {reminders.length === 0 && (
        <Reveal>
          <div className="glass p-10 text-center text-sm text-[var(--color-ink-muted)]">
            You&apos;re all caught up. Set a follow-up date on a lead to see it here.
          </div>
        </Reveal>
      )}
    </div>
  );
}
