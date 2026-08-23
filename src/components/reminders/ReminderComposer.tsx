"use client";

import { useActionState, useState } from "react";
import { createReminder, type ScheduleActionState } from "@/app/actions/schedule";

/**
 * Setting a reminder.
 *
 * "Now" is a first-class choice rather than a date you have to type, because
 * "email me this lead's state right now" is a real thing people want and
 * making them pick a time to mean "immediately" is a small daily insult.
 */
const HOLD_OPTIONS = [
  { value: "", label: "No calendar hold" },
  { value: "15", label: "Block 15 minutes" },
  { value: "30", label: "Block 30 minutes" },
  { value: "60", label: "Block 1 hour" },
];

/** Local time, formatted for datetime-local, rounded to the next quarter hour. */
function defaultWhen(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ReminderComposer({ leads }: { leads: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ScheduleActionState, FormData>(createReminder, undefined);
  const [when, setWhen] = useState<"later" | "now">("later");
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-[var(--color-brand)] px-4 py-1.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03]"
      >
        + New reminder
      </button>
    );
  }

  return (
    <form action={action} className="glass w-full space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold">New reminder</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          Cancel
        </button>
      </div>

      <label className="block">
        <span className="eyebrow mb-1.5 block">What to do</span>
        <input name="title" required maxLength={160} placeholder="Send Alleanza the revised quote" className="auth-input" />
      </label>

      <label className="block">
        <span className="eyebrow mb-1.5 block">The discussion or topic</span>
        <input name="topic" maxLength={400} placeholder="They asked for phased pricing" className="auth-input" />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="eyebrow mb-1.5 block">About which lead</span>
          <select name="brandId" className="auth-input" defaultValue="">
            <option value="">- none -</option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-[var(--color-ink-faint)]">
            Attaching a lead pulls its whole CRM state into the email.
          </span>
        </label>

        <label className="block">
          <span className="eyebrow mb-1.5 block">Calendar</span>
          <select name="holdMinutes" className="auth-input" defaultValue="">
            {HOLD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-[var(--color-ink-faint)]">
            Attaches a calendar invitation so the time is held, not just noted.
          </span>
        </label>
      </div>

      <fieldset>
        <legend className="eyebrow mb-1.5">When</legend>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="whenMode" checked={when === "later"} onChange={() => setWhen("later")} />
            At a time
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="whenMode" checked={when === "now"} onChange={() => setWhen("now")} />
            Right now
          </label>
        </div>
        {when === "later" ? (
          <input type="datetime-local" name="dueAt" defaultValue={defaultWhen()} className="auth-input mt-2" required />
        ) : (
          <input type="hidden" name="dueAt" value="now" />
        )}
      </fieldset>

      <fieldset>
        <legend className="eyebrow mb-1.5">How to reach you</legend>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="inApp" defaultChecked />
            In the app
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="email" defaultChecked />
            By email
          </label>
        </div>
      </fieldset>

      <label className="block">
        <span className="eyebrow mb-1.5 block">Anything else to remember</span>
        <textarea name="notes" rows={3} maxLength={4000} className="auth-input resize-none" />
      </label>

      {state?.error && (
        <p role="alert" className="text-sm text-[var(--color-rose)]">{state.error}</p>
      )}
      {state?.ok && (
        <p role="status" className="text-sm text-[var(--color-mint)]">
          {when === "now" ? "Sent." : "Scheduled."}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-[var(--color-brand)] px-6 py-3 text-sm font-semibold text-white transition-transform hover:scale-[1.01] disabled:opacity-60"
      >
        {pending ? "Saving..." : when === "now" ? "Send it now" : "Schedule it"}
      </button>
    </form>
  );
}
