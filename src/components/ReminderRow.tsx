"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  snoozeFollowUp,
  completeFollowUp,
  type ReminderActionState,
} from "@/app/actions/reminders";
import type { Reminder } from "@/lib/reminders";

function toneFor(bucket: Reminder["bucket"]): string {
  if (bucket === "overdue") return "var(--color-rose)";
  if (bucket === "today") return "var(--color-amber)";
  return "var(--color-ink-muted)";
}

function dueLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "due today";
  return `in ${days}d`;
}

export function ReminderRow({ r }: { r: Reminder }) {
  const [, snooze, snoozing] = useActionState<ReminderActionState, FormData>(snoozeFollowUp, undefined);
  const [, done, completing] = useActionState<ReminderActionState, FormData>(completeFollowUp, undefined);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] py-3 first:border-t-0">
      <div className="min-w-0">
        <Link
          href={`/dashboard/pipeline/${r.brand.id}`}
          className="font-medium hover:text-[var(--color-brand-bright)] hover:underline"
        >
          {r.brand.name}
        </Link>
        <div className="mt-0.5 text-xs">
          <span style={{ color: toneFor(r.bucket) }}>{dueLabel(r.days)}</span>
          <span className="text-[var(--color-ink-faint)]"> · {r.date}</span>
          {r.brand.owner && <span className="text-[var(--color-ink-faint)]"> · {r.brand.owner}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <form action={snooze} className="flex gap-1">
          <input type="hidden" name="id" value={r.brand.id} />
          {[3, 7].map((d) => (
            <button
              key={d}
              name="days"
              value={d}
              disabled={snoozing}
              className="rounded-full border border-[var(--color-border-strong)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-frosted-canvas)] hover:text-[var(--color-ink)] disabled:opacity-50"
            >
              +{d}d
            </button>
          ))}
        </form>
        <form action={done}>
          <input type="hidden" name="id" value={r.brand.id} />
          <button
            disabled={completing}
            className="rounded-full border border-[color-mix(in_srgb,var(--color-mint)_45%,transparent)] px-3 py-1 text-xs font-medium text-[var(--color-mint)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-mint)_14%,transparent)] disabled:opacity-50"
          >
            {completing ? "…" : "Done"}
          </button>
        </form>
      </div>
    </div>
  );
}
