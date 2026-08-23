"use client";

import Link from "next/link";
import { useActionState } from "react";
import { cancelReminder, completeReminder, markNotificationRead, type ScheduleActionState, type NotificationActionState } from "@/app/actions/schedule";
import type { Reminder } from "@/lib/store/reminders";
import type { Notification } from "@/lib/store/notifications";

const STATUS_TONE: Record<string, string> = {
  scheduled: "var(--color-cyan)",
  sending: "var(--color-amber)",
  sent: "var(--color-mint)",
  failed: "var(--color-rose)",
  cancelled: "var(--color-ink-faint)",
  done: "var(--color-ink-faint)",
};

const when = (iso: string): string => iso.slice(0, 16).replace("T", " ");

function SmallForm({
  action,
  id,
  label,
}: {
  action: typeof cancelReminder | typeof completeReminder;
  id: string;
  label: string;
}) {
  const [, submit, pending] = useActionState<ScheduleActionState, FormData>(action, undefined);
  return (
    <form action={submit}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-[var(--color-border-strong)] px-2.5 py-0.5 text-xs text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-ink)] disabled:opacity-50"
      >
        {pending ? "..." : label}
      </button>
    </form>
  );
}

export function ReminderCard({ r }: { r: Reminder }) {
  const live = r.status === "scheduled" || r.status === "sending";
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm">
      <span
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        style={{ background: STATUS_TONE[r.status] ?? "var(--color-ink-faint)" }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{r.title}</div>
        <div className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
          {when(r.dueAt)}
          {r.topic ? ` - ${r.topic}` : ""}
          {r.brandId && r.brandName ? (
            <>
              {" - "}
              <Link href={`/dashboard/pipeline/${r.brandId}`} className="hover:text-[var(--color-brand)]">
                {r.brandName}
              </Link>
            </>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-[var(--color-ink-faint)]">
          <span>{r.status}</span>
          {r.channels.email && <span>email</span>}
          {r.channels.inApp && <span>in app</span>}
          {r.holdMinutes ? <span>holds {r.holdMinutes} min</span> : null}
          {r.error ? <span className="text-[var(--color-rose)]">{r.error}</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {live && <SmallForm action={cancelReminder} id={r.id} label="Cancel" />}
        {r.status === "sent" && <SmallForm action={completeReminder} id={r.id} label="Done" />}
      </div>
    </li>
  );
}

export function NotificationCard({ n }: { n: Notification }) {
  const [, dismiss, pending] = useActionState<NotificationActionState, FormData>(markNotificationRead, undefined);
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-[color-mix(in_srgb,var(--color-brand)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-brand)_8%,transparent)] px-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{n.title}</div>
        <div className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{n.body}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {n.href && (
          <Link
            href={n.href}
            className="rounded-full border border-[var(--color-border-strong)] px-2.5 py-0.5 text-xs text-[var(--color-ink-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-ink)]"
          >
            Open
          </Link>
        )}
        <form action={dismiss}>
          <input type="hidden" name="id" value={n.id} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-full border border-[var(--color-border-strong)] px-2.5 py-0.5 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-50"
          >
            {pending ? "..." : "Dismiss"}
          </button>
        </form>
      </div>
    </li>
  );
}
