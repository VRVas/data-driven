import { Reveal } from "@/components/Reveal";
import { ReminderRow } from "@/components/ReminderRow";
import { getBrands } from "@/lib/data";
import { remindersFrom, type Reminder, type ReminderBucket } from "@/lib/reminders";

export const dynamic = "force-dynamic";

const SECTIONS: { bucket: ReminderBucket; title: string; blurb: string }[] = [
  { bucket: "overdue", title: "Overdue", blurb: "Past their follow-up date" },
  { bucket: "today", title: "Today", blurb: "Due today" },
  { bucket: "upcoming", title: "Upcoming", blurb: "Next 30 days" },
];

export default async function RemindersPage() {
  const brands = await getBrands();
  const reminders = remindersFrom(brands);
  const byBucket = (b: ReminderBucket): Reminder[] => reminders.filter((r) => r.bucket === b);
  const dueCount = byBucket("overdue").length + byBucket("today").length;

  return (
    <div className="space-y-8">
      <Reveal>
        <div className="eyebrow mb-2">Follow-ups</div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Reminders</h1>
        <p className="mt-1 text-[var(--color-ink-muted)]">
          {reminders.length === 0
            ? "Nothing on the radar — no open follow-ups scheduled."
            : `${dueCount} need attention · ${reminders.length} scheduled in the next 30 days.`}
        </p>
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
                  {items.length} · {blurb}
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
