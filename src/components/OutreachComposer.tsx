"use client";

import { useActionState, useEffect, useState } from "react";
import { composeOutreach, type OutreachActionState } from "@/app/actions/outreach";
import { OUTREACH_TEMPLATES, DEFAULT_TEMPLATE_ID, renderTemplate } from "@/lib/mail/templates";
import type { Brand } from "@/lib/types";

export function OutreachComposer({
  brand,
  senderName,
  isAdmin,
}: {
  brand: Brand;
  senderName: string;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-full border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-frosted-canvas)] hover:bg-[var(--color-frosted-canvas)] hover:text-[var(--color-absolute-zero)]"
      >
        Reach out
      </button>
      {open && <ComposerPanel brand={brand} senderName={senderName} isAdmin={isAdmin} onClose={() => setOpen(false)} />}
    </>
  );
}

function ComposerPanel({
  brand,
  senderName,
  isAdmin,
  onClose,
}: {
  brand: Brand;
  senderName: string;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [to, setTo] = useState(brand.email ?? "");
  const [subject, setSubject] = useState(() => renderTemplate(DEFAULT_TEMPLATE_ID, { brand, senderName }).subject);
  const [body, setBody] = useState(() => renderTemplate(DEFAULT_TEMPLATE_ID, { brand, senderName }).body);
  const [state, action, pending] = useActionState<OutreachActionState, FormData>(composeOutreach, undefined);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const r = renderTemplate(id, { brand, senderName });
    setSubject(r.subject);
    setBody(r.body);
  };

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative flex h-full w-full max-w-lg flex-col border-l border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-2xl">
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
          <div>
            <div className="eyebrow">Outreach</div>
            <h2 className="font-display text-lg font-semibold">{brand.name}</h2>
          </div>
          <button onClick={onClose} className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]" aria-label="Close">✕</button>
        </header>

        <form action={action} className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <input type="hidden" name="brandId" value={brand.id} />
          <input type="hidden" name="templateId" value={templateId} />

          <div>
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">Template</span>
            <div className="flex flex-wrap gap-1.5">
              {OUTREACH_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t.id)}
                  title={t.description}
                  className={
                    "rounded-full border px-3 py-1 text-xs transition-colors " +
                    (t.id === templateId
                      ? "border-[var(--color-brand)] bg-[color-mix(in_srgb,var(--color-brand)_16%,transparent)] text-[var(--color-ink)]"
                      : "border-[var(--color-border-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]")
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">To</span>
            <input
              name="to"
              type="email"
              required
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="name@brand.com"
              className="auth-input"
            />
            {!brand.email && (
              <span className="mt-1 block text-xs text-[var(--color-ink-faint)]">
                No contact email on file — add one on the lead to prefill this.
              </span>
            )}
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">Subject</span>
            <input name="subject" required value={subject} onChange={(e) => setSubject(e.target.value)} className="auth-input" />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">Message</span>
            <textarea name="body" required value={body} onChange={(e) => setBody(e.target.value)} rows={12} className="auth-input resize-none font-mono text-xs leading-relaxed" />
          </label>

          {state?.error && (
            <p className="rounded-lg border border-[color-mix(in_srgb,var(--color-rose)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-rose)_12%,transparent)] px-3 py-2 text-sm text-[var(--color-rose)]">
              {state.error}
            </p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-glow)] transition-transform hover:scale-[1.02] disabled:opacity-60"
            >
              {pending ? "Saving…" : isAdmin ? "Save to outbox" : "Submit for approval"}
            </button>
            <span className="text-xs text-[var(--color-ink-faint)]">
              {isAdmin ? "You can send it from the outbox." : "An admin will review and send."}
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
