"use client";

import { useActionState, useRef } from "react";
import { addComment, deleteComment, type CommentActionState } from "@/app/actions/comments";
import type { Comment } from "@/lib/store/comments";

/**
 * The discussion on a lead.
 *
 * Newest first, because a thread is read from the top and the last thing said
 * is the thing that matters. Each turn keeps its author and its date, which is
 * the whole difference from the notes field above it: a note is what the lead
 * IS, a comment is what happened and who says so.
 */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** "3 minutes ago" up to a week, then the date - relative time stops helping. */
function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return iso.slice(0, 10);
}

function DeleteButton({ id, leadId }: { id: string; leadId: string }) {
  const [, submit, pending] = useActionState<CommentActionState, FormData>(deleteComment, undefined);
  return (
    <form action={submit}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="leadId" value={leadId} />
      <button
        type="submit"
        disabled={pending}
        aria-label="Remove comment"
        className="text-xs text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-rose)] disabled:opacity-50"
      >
        {pending ? "..." : "Remove"}
      </button>
    </form>
  );
}

export function CommentThread({
  leadId,
  comments,
  meId,
  canComment,
  canDeleteAny,
}: {
  leadId: string;
  comments: Comment[];
  meId: string;
  canComment: boolean;
  canDeleteAny: boolean;
}) {
  const [state, submit, pending] = useActionState<CommentActionState, FormData>(addComment, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  // Clearing on success rather than on submit: a failed post that also ate the
  // text is how people lose a paragraph they will not retype.
  if (state?.ok) formRef.current?.reset();

  return (
    <section className="glass p-6" data-testid="comment-thread">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold">Comments</h2>
        <span className="text-xs text-[var(--color-ink-faint)]">
          {comments.length === 0 ? "Nothing yet" : `${comments.length} comment${comments.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {canComment ? (
        <form ref={formRef} action={submit} className="mb-5">
          <input type="hidden" name="leadId" value={leadId} />
          <label className="block">
            <span className="sr-only">Add a comment</span>
            <textarea
              name="body"
              rows={3}
              required
              maxLength={4000}
              placeholder="What happened, what was said, what to watch for."
              className="auth-input resize-none"
            />
          </label>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-[var(--color-ink-faint)]" role={state?.error ? "alert" : undefined}>
              {state?.error ?? "Everyone who can see this lead can read this."}
            </span>
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-[var(--color-brand)] px-4 py-1.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03] disabled:opacity-50"
            >
              {pending ? "Posting..." : "Comment"}
            </button>
          </div>
        </form>
      ) : (
        <p className="mb-5 text-sm text-[var(--color-ink-faint)]">
          You can read the discussion but not add to it - that needs the &ldquo;Comment on leads&rdquo; permission.
        </p>
      )}

      {comments.length > 0 && (
        <ol className="space-y-4">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3">
              <span
                aria-hidden
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-strong)] text-xs font-semibold text-[var(--color-ink-muted)]"
              >
                {initials(c.authorName)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium">{c.authorName}</span>
                  <span className="text-xs text-[var(--color-ink-faint)]" title={c.createdAt}>
                    {ago(c.createdAt)}
                  </span>
                  {(canDeleteAny || c.authorId === meId) && (
                    <span className="ml-auto">
                      <DeleteButton id={c.id} leadId={leadId} />
                    </span>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink-muted)]">
                  {c.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
