import { Reveal } from "@/components/Reveal";
import { ReminderRow } from "@/components/ReminderRow";
import { ReminderComposer } from "@/components/reminders/ReminderComposer";
import { ReminderCard, NotificationCard } from "@/components/reminders/ReminderCards";
import { getVisibleBrands } from "@/lib/leads/visible";
import { getSessionUser } from "@/lib/auth/guards";
import { can } from "@/lib/auth/authorize";
import { getReminderStore } from "@/lib/store/reminders";
import { getNotificationStore } from "@/lib/store/notifications";
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
  const me = await getSessionUser();
  const canSet = await can("reminder:create");

  const reminders = followUpsFrom(brands);
  const byBucket = (b: FollowUpBucket): FollowUp[] => reminders.filter((r) => r.bucket === b);
  const dueCount = byBucket("overdue").length + byBucket("today").length;

  const [mine, notifications] = me
    ? await Promise.all([
        getReminderStore().listForUser(me.id),
        getNotificationStore().listForUser(me.id, 30),
      ])
    : [[], []];
  const unread = notifications.filter((n) => !n.readAt);
  const live = mine.filter((r) => r.status === "scheduled" || r.status === "sending");
  const past = mine.filter((r) => r.status !== "scheduled" && r.status !== "sending").slice(0, 20);

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

      {unread.length > 0 && (
        <Reveal>
          <section className="glass p-6">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-display text-lg font-semibold">Notifications</h2>
              <span className="text-xs text-[var(--color-ink-faint)]">{unread.length} unread</span>
            </div>
            <ul className="space-y-2">
              {unread.map((n) => (
                <NotificationCard key={n.id} n={n} />
              ))}
            </ul>
          </section>
        </Reveal>
      )}

      {canSet && (
        <Reveal>
          <section className="glass p-6">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold">Your reminders</h2>
                <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-muted)]">
                  Set one for a time, or send it to yourself now. Attach a lead and the email carries its whole
                  CRM state; ask for a calendar hold and the time is blocked rather than just noted.
                </p>
              </div>
              <ReminderComposer leads={brands.map((b) => ({ id: b.id, name: b.name }))} />
            </div>

            {live.length === 0 && past.length === 0 ? (
              <p className="py-4 text-sm text-[var(--color-ink-faint)]">Nothing scheduled.</p>
            ) : (
              <ul className="space-y-2">
                {live.map((r) => (
                  <ReminderCard key={r.id} r={r} />
                ))}
                {past.map((r) => (
                  <ReminderCard key={r.id} r={r} />
                ))}
              </ul>
            )}
          </section>
        </Reveal>
      )}

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

      {reminders.length === 0 && live.length === 0 && (
        <Reveal>
          <div className="glass p-10 text-center text-sm text-[var(--color-ink-muted)]">
            You&apos;re all caught up. Set a follow-up date on a lead, or a reminder of your own, to see it here.
          </div>
        </Reveal>
      )}
    </div>
  );
}
