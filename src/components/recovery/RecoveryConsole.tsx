"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, Check, Download, LoaderCircle, LockKeyhole, LogOut, Pause, Play, RefreshCw, RotateCcw, Upload, X } from "lucide-react";
import type { jobView } from "@/lib/recovery/jobs";

type Job = ReturnType<typeof jobView>;
interface Snapshot {
  actor: string;
  permissions: string[];
  environment: string;
  expiresAt: string;
  state: { active: string; mode: string; epoch: number; outboundPaused: boolean; previous?: string; operation?: string };
  jobs: Job[];
}
const inputStyle = "auth-input mt-1.5 min-w-0";
const buttonStyle = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-45";
const fieldStyle = "block min-w-0 text-sm text-[var(--color-ink-muted)]";

function Command({ children, danger = false, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean; children: ReactNode }) {
  return <button {...props} className={`${buttonStyle} ${danger ? "border-[var(--color-rose)] text-[var(--color-rose)]" : ""} ${props.className ?? ""}`}>{children}</button>;
}
async function call(path: string, data?: unknown): Promise<unknown> {
  const response = await fetch(path, { method: data === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
    ...(data !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(data) } : {}) });
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.error?.message ?? `Request failed (${response.status})`), { status: response.status });
  return payload;
}
async function download(id: string, password?: string): Promise<void> {
  const response = await fetch(`/api/admin/recovery/jobs/${encodeURIComponent(id)}/download`, { method: password ? "POST" : "GET", credentials: "same-origin",
    ...(password ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) } : {}) });
  if (!response.ok) throw new Error((await response.json()).error?.message ?? "Download failed.");
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = objectUrl; link.download = `oovie-${password ? "before-" : ""}${id}.tar.gz.enc`; link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function RecoveryConsole({ initialMode }: { initialMode: string }) {
  const [hydrated, setHydrated] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [authentication, setAuthentication] = useState(initialMode === "setup" || initialMode === "maintenance" ? "key" : "account");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"import" | "backup">("import");
  const [confirmation, setConfirmation] = useState("");
  const [rollbackDownload, setRollbackDownload] = useState<string | null>(null);
  const [deliveryReview, setDeliveryReview] = useState(false);
  const [seedReview, setSeedReview] = useState(false);
  const [importMode, setImportMode] = useState<"full" | "crm">("full");
  const refresh = async () => {
    try { const result = await call("/api/admin/recovery") as Snapshot; setSnapshot(result); return result; }
    catch (failure) { if (failure && typeof failure === "object" && "status" in failure && failure.status === 401) setSnapshot(null); throw failure; }
  };
  useEffect(() => { setHydrated(true); void refresh().catch(() => undefined); }, []);
  useEffect(() => {
    if (!snapshot) return;
    const timer = setInterval(() => { void refresh().catch((failure) => { setError(failure.message); }); }, 2500);
    return () => clearInterval(timer);
  }, [!!snapshot]);
  const perform = async (name: string, action: () => Promise<void>) => {
    setBusy(name); setError("");
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The operation failed."); }
    finally { setBusy(""); }
  };
  const acceptJob = async (result: unknown) => { const job = result as Job; setSelected(job.id); setConfirmation(""); await refresh(); };
  const submitLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    void perform("login", async () => {
      await call("/api/admin/recovery/session", authentication === "key" ? { recoveryKey: values.get("recoveryKey") } : { email: values.get("email"), password: values.get("password") });
      form.reset(); await refresh();
    });
  };
  const upload = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); data.set("mode", importMode);
    void perform("upload", async () => {
      const response = await fetch("/api/admin/recovery/upload", { method: "POST", body: data, credentials: "same-origin" });
      const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? "Upload failed.");
      form.reset(); await acceptJob(result);
    });
  };
  const active = snapshot?.state.mode === "maintenance";
  const currentJob = snapshot?.jobs.find((job) => job.id === (selected ?? snapshot.state.operation));
  const mayRestore = !!snapshot?.permissions.includes("data:restore");
  const notice = error && <p role="alert" className="flex items-start gap-2 border-l-2 border-[var(--color-rose)] bg-[var(--color-surface)] p-3 text-sm"><AlertTriangle size={18} className="shrink-0 text-[var(--color-rose)]" aria-hidden="true" />{error}</p>;

  if (!snapshot) return <section className="max-w-lg border-y border-[var(--color-border)] py-6">
    <h2 className="font-display text-xl" style={{ letterSpacing: 0 }}>Authorize database access</h2>
    <div role="tablist" aria-label="Recovery authentication" className="mt-5 flex gap-5 border-b border-[var(--color-border)]">
      {[["account", "Administrator"], ["key", "Environment recovery key"]].map(([value, label]) => <button key={value} role="tab" aria-selected={authentication === value} onClick={() => setAuthentication(value)} className={`min-h-11 border-b-2 pb-2 text-sm ${authentication === value ? "border-[var(--color-cyan)]" : "border-transparent text-[var(--color-ink-muted)]"}`}>{label}</button>)}
    </div>
    <form method="post" onSubmit={submitLogin} className="mt-5 space-y-4">
      <fieldset disabled={!hydrated || !!busy} className="space-y-4">
      {authentication === "key" ? <label className={fieldStyle}>Recovery key<input name="recoveryKey" type="password" required minLength={32} maxLength={512} autoComplete="off" className={inputStyle} /></label> : <>
        <label className={fieldStyle}>Administrator email<input name="email" type="email" required autoComplete="username" className={inputStyle} /></label>
        <label className={fieldStyle}>Password<input name="password" type="password" required autoComplete="current-password" className={inputStyle} /></label>
      </>}
      {notice}<Command type="submit" disabled={!!busy}><LockKeyhole size={17} aria-hidden="true" />{busy ? "Verifying..." : "Unlock recovery"}</Command>
      </fieldset>
    </form>
  </section>;

  return <div className="space-y-7">
    <section className="grid gap-4 border-y border-[var(--color-border)] py-4 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0"><p className="break-all font-mono text-sm">{snapshot.environment}</p><p className="mt-1 break-all text-xs text-[var(--color-ink-muted)]">{snapshot.state.active} / {snapshot.actor}</p></div>
      <div className="flex flex-wrap items-center gap-2"><span className={`text-sm ${active ? "text-[var(--color-amber)]" : "text-[var(--color-mint)]"}`}>{active ? "Maintenance" : snapshot.state.mode === "setup" ? "Not initialized" : "Ready"}</span>
        <button title="Refresh status" aria-label="Refresh status" className={`${buttonStyle} !px-3`} onClick={() => void perform("refresh", async () => { await refresh(); })}><RefreshCw size={17} aria-hidden="true" /></button>
        <button title="Lock recovery" aria-label="Lock recovery" className={`${buttonStyle} !px-3`} onClick={() => void perform("logout", async () => { await fetch("/api/admin/recovery/session", { method: "DELETE" }); setSnapshot(null); })}><LogOut size={17} aria-hidden="true" /></button>
      </div>
    </section>
    {notice}
    {active && <p role="status" className="flex items-center gap-3 text-sm text-[var(--color-amber)]"><LoaderCircle size={18} className="animate-spin" aria-hidden="true" />Normal data access and delivery are paused.</p>}
    <div role="tablist" aria-label="Data operations" className="flex gap-6 border-b border-[var(--color-border)]">
      {(["import", "backup"] as const).map((value) => <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`min-h-11 border-b-2 pb-2 text-sm ${tab === value ? "border-[var(--color-cyan)]" : "border-transparent text-[var(--color-ink-muted)]"}`}>{value === "import" ? "Import & restore" : "Backups"}</button>)}
    </div>
    {tab === "import" && mayRestore && <section aria-labelledby="import-title" className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
      <form onSubmit={upload} className="min-w-0 space-y-4">
        <h2 id="import-title" className="font-display text-xl" style={{ letterSpacing: 0 }}>{snapshot.state.mode === "setup" ? "Initialize from backup" : "Import a backup"}</h2>
        <label className={fieldStyle}>Backup package<input type="file" name="file" accept=".gz,.enc,.oovie-backup" required disabled={!!busy || active} className="mt-2 block w-full min-w-0 rounded-md border border-[var(--color-border-strong)] p-3 text-sm file:mr-3 file:border-0 file:bg-transparent file:text-[var(--color-cyan)]" /></label>
        <label className={fieldStyle}>Backup password <span className="text-xs">(encrypted packages)</span><input type="password" name="password" maxLength={512} autoComplete="off" className={inputStyle} /></label>
        <fieldset className="space-y-2"><legend className="mb-2 text-sm text-[var(--color-ink-muted)]">Import scope</legend>
          <label className="flex items-start gap-2 text-sm"><input type="radio" name="scope" value="full" checked={importMode === "full"} onChange={() => setImportMode("full")} className="mt-1" />Full dataset, including accounts and profiles</label>
          <label className={`flex items-start gap-2 text-sm ${snapshot.state.mode === "setup" ? "opacity-40" : ""}`}><input type="radio" name="scope" value="crm" checked={importMode === "crm"} disabled={snapshot.state.mode === "setup"} onChange={() => setImportMode("crm")} className="mt-1" />CRM data; retain current accounts, profiles and audit</label>
        </fieldset>
        <Command type="submit" disabled={!!busy || active}><Upload size={17} aria-hidden="true" />{busy === "upload" ? "Validating..." : "Upload & validate"}</Command>
      </form>
      <aside className="min-w-0 border-t border-[var(--color-border)] pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        <h2 className="font-display text-lg" style={{ letterSpacing: 0 }}>Other recovery options</h2>
        <div className="mt-4 flex flex-wrap gap-3"><Command disabled={active || !!busy} onClick={() => setSeedReview(!seedReview)}><RefreshCw size={17} aria-hidden="true" />Built-in dataset</Command>
          {snapshot.state.previous && <Command disabled={active || !!busy} onClick={() => void perform("rollback", async () => acceptJob(await call("/api/admin/recovery", { action: "rollback" })))}><RotateCcw size={17} aria-hidden="true" />Review rollback</Command>}
        </div>
        {seedReview && <form className="mt-5 space-y-3" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); void perform("seed", async () => { await acceptJob(await call("/api/admin/recovery", { action: "seed", ...(snapshot.state.mode === "setup" ? { administrator: { name: values.get("name"), email: values.get("email"), password: values.get("password") } } : {}) })); setSeedReview(false); }); }}>
          {snapshot.state.mode === "setup" && <><label className={fieldStyle}>Administrator name<input name="name" required className={inputStyle} /></label><label className={fieldStyle}>Email<input name="email" type="email" required className={inputStyle} /></label><label className={fieldStyle}>New password<input name="password" type="password" minLength={8} required autoComplete="new-password" className={inputStyle} /></label></>}
          {snapshot.state.mode !== "setup" && <p className="text-sm text-[var(--color-ink-muted)]">Business data will be replaced by the built-in dataset. Accounts and audit will be retained.</p>}
          <Command type="submit" disabled={!!busy}>Review seed operation</Command>
        </form>}
      </aside>
    </section>}
    {tab === "backup" && <section className="max-w-lg" aria-labelledby="backup-title"><h2 id="backup-title" className="font-display text-xl" style={{ letterSpacing: 0 }}>Create encrypted backup</h2>
      <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); void perform("backup", async () => {
        if (values.get("password") !== values.get("repeat")) throw new Error("Backup passwords do not match.");
        await acceptJob(await call("/api/admin/recovery/backup", { password: values.get("password") })); form.reset();
      }); }}>
        <label className={fieldStyle}>Backup password<input name="password" type="password" minLength={12} maxLength={512} required autoComplete="new-password" className={inputStyle} /></label>
        <label className={fieldStyle}>Repeat backup password<input name="repeat" type="password" minLength={12} required autoComplete="new-password" className={inputStyle} /></label>
        <p className="text-xs text-[var(--color-ink-muted)]">Includes user password hashes and private records. The download password cannot be recovered.</p>
        <Command type="submit" disabled={!!busy || active || snapshot.state.mode !== "ready"}><LockKeyhole size={17} aria-hidden="true" />Create backup</Command>
      </form>
    </section>}
    {currentJob && <section aria-labelledby="operation-title" className="border-y border-[var(--color-border)] py-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="operation-title" className="font-display text-xl" style={{ letterSpacing: 0 }}>{currentJob.status === "review" ? "Review before replacement" : "Operation status"}</h2><p role="status" className="mt-2 text-sm text-[var(--color-ink-muted)]">{currentJob.progress}</p></div><span className="font-mono text-sm">{currentJob.status}</span></div>
      <p className="mt-3 break-all text-xs text-[var(--color-ink-muted)]">Destination: {currentJob.base}</p>
      {currentJob.error && <p role="alert" className="mt-4 text-sm text-[var(--color-rose)]">{currentJob.error}</p>}
      <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">{currentJob.report.containers.map((container) => <div key={container.name} className="flex min-w-0 justify-between gap-2 border-b border-[var(--color-border)] py-2"><span className="break-all text-[var(--color-ink-muted)]">{container.name}</span><span className="font-mono">{container.documents}</span></div>)}</div>
      {!!currentJob.report.changes.length && <ul className="mt-5 space-y-2 text-sm">{currentJob.report.changes.map((change, index) => <li key={index} className="flex items-start gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-[var(--color-amber)]" aria-hidden="true" /><span>{change.container}{change.count ? ` (${change.count})` : ""}: {change.reason}</span></li>)}</ul>}
      {!!currentJob.report.warnings.length && <ul className="mt-4 space-y-1 text-sm text-[var(--color-amber)]">{currentJob.report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      {currentJob.status === "review" && mayRestore && <form className="mt-6 max-w-xl space-y-3" onSubmit={(event) => { event.preventDefault(); void perform("confirm", async () => acceptJob(await call("/api/admin/recovery", { action: "confirm", id: currentJob.id, confirmation }))); }}>
        <p className="text-sm">{snapshot.state.mode === "setup" ? "The validated dataset will initialize this environment." : "This replaces the active dataset. The current dataset will remain available for rollback."} Imported delivery jobs remain paused.</p>
        <label className={fieldStyle}>Type <strong className="break-all font-mono text-[var(--color-ink)]">{currentJob.confirmation}</strong><input aria-label="Replacement confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" className={inputStyle} /></label>
        <Command type="submit" danger disabled={!!busy || confirmation !== currentJob.confirmation}><Check size={17} aria-hidden="true" />{snapshot.state.mode === "setup" ? "Initialize environment" : "Replace active dataset"}</Command>
      </form>}
      <div className="mt-5 flex flex-wrap gap-3">
        {currentJob.downloadable && <Command disabled={!!busy} onClick={() => void perform("download", () => download(currentJob.id))}><Download size={17} aria-hidden="true" />Download encrypted backup</Command>}
        {currentJob.hasRollback && <Command disabled={!!busy} onClick={() => setRollbackDownload(currentJob.id)}><Download size={17} aria-hidden="true" />Download pre-operation backup</Command>}
        {mayRestore && ["review", "queued", "running", "failed"].includes(currentJob.status) && <Command disabled={!!busy} onClick={() => void perform("cancel", async () => acceptJob(await call("/api/admin/recovery", { action: "cancel", id: currentJob.id })))}><X size={17} aria-hidden="true" />Cancel operation</Command>}
      </div>
    </section>}
    {rollbackDownload && <form className="max-w-lg space-y-3 border-b border-[var(--color-border)] pb-6" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); void perform("rollback-download", async () => { await download(rollbackDownload, String(values.get("password"))); setRollbackDownload(null); }); }}>
      <label className={fieldStyle}>Password for rollback download<input name="password" type="password" required minLength={12} autoComplete="new-password" className={inputStyle} /></label><Command type="submit" disabled={!!busy}><Download size={17} aria-hidden="true" />Download rollback package</Command>
    </form>}
    <section aria-labelledby="history-title"><h2 id="history-title" className="font-display text-xl" style={{ letterSpacing: 0 }}>Recent operations</h2>
      {!snapshot.jobs.length ? <p className="mt-4 text-sm text-[var(--color-ink-muted)]">No recovery operations yet.</p> : <div className="mt-4 divide-y divide-[var(--color-border)]">{snapshot.jobs.map((job) => <button key={job.id} onClick={() => { setSelected(job.id); setConfirmation(""); }} className="grid w-full grid-cols-[1fr_auto] items-center gap-3 py-3 text-left text-sm hover:bg-[var(--color-surface)] sm:grid-cols-[100px_1fr_auto]">
        <span className="capitalize">{job.type}</span><span className="min-w-0 break-words text-xs text-[var(--color-ink-muted)]">{new Date(job.createdAt).toLocaleString()} / {job.actor}</span><span className="font-mono text-xs">{job.status}</span>
      </button>)}</div>}
    </section>
    {mayRestore && snapshot.state.mode === "ready" && <section className="border-t border-[var(--color-border)] pt-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-lg" style={{ letterSpacing: 0 }}>Outbound delivery</h2><p className="mt-1 text-sm text-[var(--color-ink-muted)]">{snapshot.state.outboundPaused ? "Paused" : "Enabled"}</p></div><Command onClick={() => setDeliveryReview(!deliveryReview)}>{snapshot.state.outboundPaused ? <Play size={17} aria-hidden="true" /> : <Pause size={17} aria-hidden="true" />}{snapshot.state.outboundPaused ? "Review activation" : "Pause delivery"}</Command></div>
      {deliveryReview && <form className="mt-4 max-w-lg space-y-3" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); void perform("delivery", async () => { await call("/api/admin/recovery", { action: "delivery", enabled: snapshot.state.outboundPaused, confirmation: values.get("confirmation") }); setDeliveryReview(false); await refresh(); }); }}><label className={fieldStyle}>Type {snapshot.state.outboundPaused ? "ENABLE DELIVERY" : "PAUSE DELIVERY"}<input name="confirmation" required autoComplete="off" className={inputStyle} /></label><Command type="submit" disabled={!!busy}>Confirm delivery setting</Command></form>}
    </section>}
  </div>;
}