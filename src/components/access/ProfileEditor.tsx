"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { clsx } from "clsx";
import { saveProfile, type AccessActionState } from "@/app/actions/access";
import { OverlayPortal } from "@/components/ui/OverlayPortal";
import {
  PERMISSION_KEYS,
  permissionsByCategory,
  type PermissionDef,
  type PermissionKey,
  type PermissionMap,
  type Scope,
} from "@/lib/auth/catalogue";
import type { Profile } from "@/lib/auth/profiles";

const SCOPE_OPTIONS: Array<{ value: Scope; short: string; label: string }> = [
  { value: "none", short: "None", label: "No access" },
  { value: "own", short: "Own", label: "Own records" },
  { value: "team", short: "Team", label: "Team" },
  { value: "all", short: "All", label: "Everything" },
];

const CATEGORIES = permissionsByCategory();

/** Mounted only while open - remounting gives each session fresh action state. */
export function ProfileEditor({
  profile,
  onClose,
  duplicateOf = null,
}: {
  profile: Profile | null;
  onClose: () => void;
  duplicateOf?: Profile | null;
}) {
  const isNew = profile === null;
  const source = profile ?? duplicateOf;
  const titleId = useId();

  const [state, action, pending] = useActionState<AccessActionState, FormData>(saveProfile, undefined);
  const [permissions, setPermissions] = useState<PermissionMap>(() => ({ ...(source?.permissions ?? {}) }));

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setScope = (key: PermissionKey, scope: Scope) =>
    setPermissions((prev) => {
      const next = { ...prev };
      if (scope === "none") delete next[key];
      else next[key] = scope;
      return next;
    });

  const setMany = (defs: readonly PermissionDef[], scope: Scope) =>
    setPermissions((prev) => {
      const next = { ...prev };
      for (const def of defs) {
        const key = def.key as PermissionKey;
        if (scope === "none") delete next[key];
        else next[key] = scope;
      }
      return next;
    });

  const grantedTotal = Object.keys(permissions).length;
  const heading = isNew ? (duplicateOf ? `Duplicate ${duplicateOf.name}` : "New profile") : profile!.name;

  return (
    <OverlayPortal>
      <div className="fixed inset-0 z-[100] flex justify-end">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="relative flex h-full w-full max-w-2xl flex-col border-l border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-2xl"
        >
          <header className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <div className="eyebrow mb-1">Permission profile</div>
              <h2 id={titleId} className="truncate font-display text-lg font-semibold">
                {heading}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              aria-label="Close"
            >
              ✕
            </button>
          </header>

          <form action={action} className="flex min-h-0 flex-1 flex-col">
            <input type="hidden" name="id" value={profile?.id ?? ""} />
            <input type="hidden" name="permissions" value={JSON.stringify(permissions)} />

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
                  Profile name<span className="text-[var(--color-rose)]"> *</span>
                </span>
                <input
                  name="name"
                  required
                  maxLength={60}
                  defaultValue={duplicateOf ? `${duplicateOf.name} copy` : (profile?.name ?? "")}
                  className="auth-input"
                  placeholder="e.g. Outreach approver"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
                  Description
                </span>
                <textarea
                  name="description"
                  rows={2}
                  maxLength={200}
                  defaultValue={source?.description ?? ""}
                  className="auth-input resize-none"
                  placeholder="What this profile is for, in one line."
                />
              </label>

              <div className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-display text-base font-semibold">Permissions</h3>
                  <span className="text-xs text-[var(--color-ink-faint)]">
                    {grantedTotal} of {PERMISSION_KEYS.length} granted
                  </span>
                </div>
                <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink-faint)]">
                  Own and team scopes are saved with the profile, but records aren&apos;t filtered by owner yet - on
                  leads they currently behave like full access. Per-record scoping is coming.
                </p>

                {CATEGORIES.map(({ category, permissions: defs }) => {
                  const granted = defs.filter((d) => (permissions[d.key as PermissionKey] ?? "none") !== "none").length;
                  return (
                    <section key={category} className="rounded-2xl border border-[var(--color-border)]">
                      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
                        <div>
                          <h4 className="text-sm font-semibold">{category}</h4>
                          <p className="text-xs text-[var(--color-ink-faint)]">
                            {granted} of {defs.length} granted
                          </p>
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => setMany(defs, "all")}
                            className="rounded-full border border-[var(--color-border-strong)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                          >
                            Grant all
                          </button>
                          <button
                            type="button"
                            onClick={() => setMany(defs, "none")}
                            className="rounded-full border border-[var(--color-border-strong)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                          >
                            Clear
                          </button>
                        </div>
                      </header>
                      <div>
                        {defs.map((def) => (
                          <PermissionRow
                            key={def.key}
                            def={def}
                            scope={permissions[def.key as PermissionKey] ?? "none"}
                            onChange={(scope) => setScope(def.key as PermissionKey, scope)}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>

            <footer className="space-y-3 border-t border-[var(--color-border)] px-5 py-4 sm:px-6">
              {state?.error && (
                <p
                  role="alert"
                  className="rounded-lg border border-[color-mix(in_srgb,var(--color-rose)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-rose)_12%,transparent)] px-3 py-2 text-sm text-[var(--color-rose)]"
                >
                  {state.error}
                </p>
              )}
              <button
                type="submit"
                disabled={pending}
                className="w-full rounded-full bg-[var(--color-brand)] px-6 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow)] transition-transform hover:scale-[1.02] disabled:opacity-60"
              >
                {pending ? "Saving…" : isNew ? "Create profile" : "Save changes"}
              </button>
            </footer>
          </form>
        </div>
      </div>
    </OverlayPortal>
  );
}

function PermissionRow({
  def,
  scope,
  onChange,
}: {
  def: PermissionDef;
  scope: Scope;
  onChange: (scope: Scope) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--color-border)] px-4 py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{def.label}</span>
          {def.risk === "high" && (
            <span className="rounded-full border border-[color-mix(in_srgb,var(--color-amber)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-amber)_12%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-amber)]">
              High risk
            </span>
          )}
        </div>
        {def.help && <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">{def.help}</p>}
      </div>
      {def.scoped ? (
        <ScopeControl label={def.label} value={scope} onChange={onChange} />
      ) : (
        <GrantToggle label={def.label} on={scope !== "none"} onChange={(on) => onChange(on ? "all" : "none")} />
      )}
    </div>
  );
}

function ScopeControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Scope;
  onChange: (scope: Scope) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`Access level for ${label}`}
      className="flex w-full shrink-0 overflow-hidden rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] sm:w-auto"
    >
      {SCOPE_OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.value)}
            className={clsx(
              "flex-1 px-2.5 py-1.5 text-[11px] font-medium transition-colors sm:flex-none",
              active
                ? "bg-[var(--color-brand)] text-white"
                : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
            )}
          >
            <span className="sm:hidden">{option.short}</span>
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function GrantToggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2 sm:justify-end">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`Grant "${label}"`}
        onClick={() => onChange(!on)}
        className={clsx(
          "relative inline-flex h-6 w-11 items-center rounded-full border transition-colors",
          on ? "border-transparent bg-[var(--color-brand)]" : "border-[var(--color-border-strong)] bg-[var(--color-surface)]",
        )}
      >
        <span
          className={clsx(
            "ml-0.5 h-4 w-4 rounded-full transition-transform",
            on ? "translate-x-5 bg-white" : "translate-x-0 bg-[var(--color-ink-faint)]",
          )}
        />
      </button>
      <span aria-hidden className="w-16 text-[11px] font-medium text-[var(--color-ink-faint)] sm:w-auto">
        {on ? "Granted" : "No access"}
      </span>
    </div>
  );
}
