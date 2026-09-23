import Link from "next/link";
import { ArrowLeft, Database } from "lucide-react";
import { RecoveryConsole } from "@/components/recovery/RecoveryConsole";
import { recoveryEnabled } from "@/lib/recovery/backend";
import { recoveryState } from "@/lib/recovery/control";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data & Recovery - OOVIE" };

export default async function RecoveryPage() {
  const enabled = recoveryEnabled();
  let mode = "unavailable";
  try { if (enabled) mode = (await recoveryState()).mode; } catch { mode = "unavailable"; }
  return <main className="relative mx-auto min-h-screen max-w-6xl px-5 py-8 sm:px-8">
    <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-border)] pb-5">
      <Link href="/" className="font-display text-2xl" style={{ letterSpacing: 0 }}>OOVIE</Link>
      <Link href="/dashboard/team" className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]"><ArrowLeft size={16} aria-hidden="true" /> Back to workspace</Link>
    </header>
    <div className="mb-7 flex items-start gap-3"><Database size={26} className="mt-1 shrink-0 text-[var(--color-cyan)]" aria-hidden="true" /><div>
      <h1 className="font-display text-3xl" style={{ letterSpacing: 0 }}>Data &amp; Recovery</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{!enabled ? "Not enabled on this deployment" : mode === "setup" ? "Environment awaiting initialization" : mode === "maintenance" ? "Maintenance in progress" : mode === "unavailable" ? "Recovery storage unavailable" : "Database administration"}</p>
    </div></div>
    {enabled && mode !== "unavailable" ? <RecoveryConsole initialMode={mode} /> : <p role="status" className="border-y border-[var(--color-border)] py-6 text-sm">{enabled ? "Check the recovery database and managed identity permissions." : "An environment owner must enable data recovery in the deployment configuration."}</p>}
  </main>;
}