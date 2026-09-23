"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { createTelegramLink, confirmTelegramLink, revokeTelegramLink, type IntegrationActionState } from "@/app/actions/integrations";

export function TelegramConnection({ enabled, linked, pending }: {
  enabled: boolean;
  linked: { id: string; name: string } | null;
  pending: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const [created, create, creating] = useActionState<IntegrationActionState, FormData>(createTelegramLink, undefined);
  const [confirmed, confirm, confirming] = useActionState<IntegrationActionState, FormData>(confirmTelegramLink, undefined);
  const [revoked, revoke, revoking] = useActionState<IntegrationActionState, FormData>(revokeTelegramLink, undefined);
  const button = "rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm disabled:opacity-50 hover:border-[var(--color-ink-muted)]";
  const error = created?.error ?? confirmed?.error ?? revoked?.error;
  return (
    <section className="border-y border-[var(--color-border)] py-6" aria-labelledby="telegram-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="telegram-heading" className="font-display text-xl font-semibold">Telegram</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{!enabled ? "Not enabled on this deployment" : linked ? "Connected" : pending ? "Confirmation pending" : "Not connected"}</p>
        </div>
        {enabled && linked && <form action={revoke}><button className={button} disabled={revoking}>{revoking ? "Disconnecting..." : "Disconnect"}</button></form>}
      </div>
      {linked && <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-[var(--color-ink-faint)]">Account</dt><dd>{linked.name}</dd></div><div><dt className="text-[var(--color-ink-faint)]">Telegram user ID</dt><dd className="font-mono">{linked.id}</dd></div></dl>}
      {enabled && pending && <form action={confirm} className="mt-5 flex flex-wrap items-center gap-4">
        <input name="candidateId" type="hidden" value={pending.id} />
        <div className="min-w-0"><p className="break-words text-sm">{pending.name}</p><p className="font-mono text-xs text-[var(--color-ink-muted)]">{pending.id}</p></div>
        <button className={button} disabled={confirming}>{confirming ? "Confirming..." : "Confirm this account"}</button>
      </form>}
      {enabled && !linked && !pending && <div className="mt-5 flex flex-wrap items-center gap-3">
        <form action={create}><button className={button} disabled={creating}>{creating ? "Creating link..." : "Connect Telegram"}</button></form>
        {created?.url && <a className={button} href={created.url} target="_blank" rel="noopener noreferrer">Open Telegram</a>}
        {created?.url && <button className={button} onClick={() => router.refresh()}>Check connection</button>}
      </div>}
      {error && <p role="alert" className="mt-3 text-sm text-[var(--color-rose)]">{error}</p>}
    </section>
  );
}