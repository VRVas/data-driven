"use client";

import { useActionState, useEffect, useRef } from "react";
import { appendNote, type NoteActionState } from "@/app/actions/notes";
import type { NoteEntry } from "@/lib/store/notes";

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toISOString().slice(0, 10);
};

/**
 * One Notes section: the initial note, then everything learned since.
 *
 * The initial note is what the lead IS - how it came in, what to be careful of
 * - and it is the only part that lives on the lead record itself, because it is
 * what exports and reminder emails lead with. Everything after it is appended
 * here with a name and a date, so nothing anybody wrote is ever overwritten by
 * whoever saves next.
 */
export function NotesThread({
  leadId,
  initialNote,
  entries,
  canAppend,
}: {
  leadId: string;
  initialNote: string | null;
  entries: NoteEntry[];
  canAppend: boolean;
}) {
  const [state, action, pending] = useActionState<NoteActionState, FormData>(appendNote, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state?.ok]);

  const empty = !initialNote && entries.length === 0;

  return (
    <section className="glass p-6">
      <h2 className="font-display text-lg font-semibold">Notes</h2>

      {empty ? (
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Nothing recorded. Use Edit to set the initial note - what this lead is, how it came in, what to be
          careful of. It travels with the lead into exports and reminder emails. Anything you learn later goes
          below it, so the first note stays the first note.
        </p>
      ) : (
        <ol className="mt-4 space-y-4">
          {initialNote && (
            <li className="border-l-2 border-[var(--color-brand)] pl-4">
              <div className="eyebrow mb-1">Initial note</div>
              <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink-muted)]">
                {initialNote}
              </p>
            </li>
          )}
          {entries.map((e) => (
            <li key={e.id} className="border-l-2 border-[var(--color-border-strong)] pl-4">
              <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-[var(--color-ink-faint)]">
                <span className="font-medium text-[var(--color-ink-muted)]">{e.authorName}</span>
                <time dateTime={e.createdAt} className="tabular-nums">
                  {when(e.createdAt)}
                </time>
              </div>
              <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink-muted)]">
                {e.body}
              </p>
            </li>
          ))}
        </ol>
      )}

      {canAppend && (
        <form ref={formRef} action={action} className="mt-5 border-t border-[var(--color-border)] pt-4">
          <input type="hidden" name="leadId" value={leadId} />
          <label htmlFor="note-body" className="eyebrow mb-1.5 block">
            Add to notes
          </label>
          <textarea
            id="note-body"
            name="body"
            rows={3}
            required
            maxLength={4000}
            placeholder="What happened, what was said, what to watch for."
            className="auth-input w-full resize-none"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--color-ink-faint)]">
              Appended with your name and today&rsquo;s date. Nothing already written is replaced.
            </p>
            <button
              type="submit"
              disabled={pending}
              className="shrink-0 rounded-full bg-[var(--color-brand)] px-4 py-1.5 text-sm font-semibold text-[var(--color-on-brand)] disabled:opacity-50"
            >
              {pending ? "Adding..." : "Add"}
            </button>
          </div>
          {state?.error && (
            <p role="alert" className="mt-2 text-xs text-[var(--color-rose)]">
              {state.error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
