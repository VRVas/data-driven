"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  sendOutreach,
  cancelOutreach,
  type OutreachActionState,
} from "@/app/actions/outreach";
import type { Outreach, OutreachStatus } from "@/lib/store/outreach";
import { relativeTime } from "@/lib/time";

const STATUS_META: Record<OutreachStatus, { label: string; color: string }> = {
  draft: { label: "Draft", color: "var(--color-ink-muted)" },
  pending_approval: { label: "Pending approval", color: "var(--color-amber)" },
  sent: { label: "Sent", color: "var(--color-mint)" },
  failed: { label: "Failed", color: "var(--color-rose)" },
  cancelled: { label: "Cancelled", color: "var(--color-ink-faint)" },
};

export function OutreachItem({
  o,
  isAdmin,
  meId,
  showBrand = false,
}: {
  o: Outreach;
  isAdmin: boolean;
  meId: string;
  showBrand?: boolean;
}) {
  const [sendState, send, sending] = useActionState<OutreachActionState, FormData>(sendOutreach, undefined);
  const [cancelState, cancel, cancelling] = useActionState<OutreachActionState, FormData>(cancelOutreach, undefined);

  const meta = STATUS_META[o.status];
  const canSend = isAdmin && (o.status === "pending_approval" || o.status === "draft" || o.status === "failed");
  const canCancel = (o.status === "draft" || o.status === "pending_approval") && (isAdmin || o.createdById === meId);
  const err = sendState?.error ?? cancelState?.error;

  return (
    <div className="border-t border-[var(--color-border)] py-4 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]"
              style={{ color: meta.color, borderColor: `color-mix(in srgb, ${meta.color} 45%, transparent)` }}
            >
              {meta.label}
            </span>
            {showBrand && (
              <Link href={`/dashboard/pipeline/${o.brandId}`} className="text-sm font-medium hover:underline">
                {o.brandName}
              </Link>
            )}
            <span className="text-sm text-[var(--color-ink)]">{o.subject}</span>
          </div>
          <div className="mt-1 text-xs text-[var(--color-ink-faint)]">
            to {o.to} - {o.createdByName} - <time dateTime={o.createdAt}>{relativeTime(o.createdAt)}</time>
            {o.status === "sent" && o.provider ? ` - via ${o.provider}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {canSend && (
            <form action={send}>
              <input type="hidden" name="id" value={o.id} />
              <button
                disabled={sending}
                className="rounded-full bg-[var(--color-brand)] px-3 py-1 text-xs font-medium text-white transition-transform hover:scale-[1.03] disabled:opacity-60"
              >
                {sending ? "Sending…" : o.status === "pending_approval" ? "Approve & send" : "Send"}
              </button>
            </form>
          )}
          {canCancel && (
            <form action={cancel}>
              <input type="hidden" name="id" value={o.id} />
              <button
                disabled={cancelling}
                className="rounded-full border border-[var(--color-border-strong)] px-3 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-60"
              >
                Cancel
              </button>
            </form>
          )}
        </div>
      </div>
      <p className="mt-2 line-clamp-2 whitespace-pre-line text-xs text-[var(--color-ink-muted)]">{o.body}</p>
      {o.error && <p className="mt-1 text-xs text-[var(--color-rose)]">{o.error}</p>}
      {err && <p className="mt-1 text-xs text-[var(--color-rose)]">{err}</p>}
    </div>
  );
}
