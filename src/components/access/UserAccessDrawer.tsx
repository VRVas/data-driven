"use client";

import { useActionState, useEffect, useId, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import {
  assignProfiles,
  createUser,
  setUserActive,
  type AccessActionState,
} from "@/app/actions/access";
import { OverlayPortal } from "@/components/ui/OverlayPortal";

export interface ProfileChoice {
  id: string;
  name: string;
  description: string;
}

export interface AccessPerson {
  id: string;
  name: string;
  email: string;
  active: boolean;
  isSelf: boolean;
  profileIds: string[];
  profiles: Array<{ id: string; name: string }>;
}

// ---------------------------------------------------------------------------
// Create person
// ---------------------------------------------------------------------------

export function CreatePersonDrawer({ profiles, onClose }: { profiles: ProfileChoice[]; onClose: () => void }) {
  const [state, action, pending] = useActionState<AccessActionState, FormData>(createUser, undefined);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  return (
    <DrawerShell title="New person" onClose={onClose}>
      <form action={action} className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="profileIds" value={selected.join(",")} />

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          <Field label="Full name" required>
            <input name="name" required maxLength={80} className="auth-input" placeholder="e.g. Ada Karras" />
          </Field>

          <Field label="Email" required>
            <input type="email" name="email" required className="auth-input" placeholder="name@company.com" />
          </Field>

          <Field label="Temporary password" required hint="At least 10 characters. Share it out of band.">
            <input type="password" name="password" required minLength={10} className="auth-input" />
          </Field>

          <ProfileChecklist
            profiles={profiles}
            selected={selected}
            onToggle={(id) =>
              setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
            }
          />
        </div>

        <DrawerFooter error={state?.error}>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-full bg-[var(--color-brand)] px-6 py-3 text-sm font-semibold text-[var(--color-on-brand)] shadow-[var(--shadow-glow)] transition-transform hover:scale-[1.02] disabled:opacity-60"
          >
            {pending ? "Creating…" : "Create person"}
          </button>
        </DrawerFooter>
      </form>
    </DrawerShell>
  );
}

// ---------------------------------------------------------------------------
// Assign access
// ---------------------------------------------------------------------------

export function AssignAccessDrawer({
  person,
  profiles,
  onClose,
  canDeactivate = false,
}: {
  person: AccessPerson;
  profiles: ProfileChoice[];
  onClose: () => void;
  canDeactivate?: boolean;
}) {
  const [state, action, pending] = useActionState<AccessActionState, FormData>(assignProfiles, undefined);
  const [selected, setSelected] = useState<string[]>(person.profileIds);

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  return (
    <DrawerShell title={person.name} onClose={onClose}>
      <form action={action} className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="id" value={person.id} />
        <input type="hidden" name="profileIds" value={selected.join(",")} />

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          <p className="font-mono text-xs text-[var(--color-ink-muted)]">{person.email}</p>

          {person.isSelf && (
            <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink-faint)]">
              You can&apos;t change your own access - ask another administrator.
            </p>
          )}

          <ProfileChecklist
            profiles={profiles}
            selected={selected}
            disabled={person.isSelf}
            onToggle={(id) =>
              setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
            }
          />
        </div>

        <DrawerFooter error={state?.error}>
          <button
            type="submit"
            disabled={pending || person.isSelf}
            className="w-full rounded-full bg-[var(--color-brand)] px-6 py-3 text-sm font-semibold text-[var(--color-on-brand)] shadow-[var(--shadow-glow)] transition-transform hover:scale-[1.02] disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save access"}
          </button>
        </DrawerFooter>
      </form>

      {canDeactivate && !person.isSelf && (
        <div className="border-t border-[var(--color-border)] px-5 py-4 sm:px-6">
          <ActiveControl id={person.id} active={person.active} onDone={onClose} />
        </div>
      )}
    </DrawerShell>
  );
}

function ActiveControl({ id, active, onDone }: { id: string; active: boolean; onDone: () => void }) {
  const [state, action, pending] = useActionState<AccessActionState, FormData>(setUserActive, undefined);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-[var(--color-ink-faint)]">
          {confirming
            ? active
              ? "They'll be signed out and blocked from signing in."
              : "They'll be able to sign in again."
            : active
              ? "Suspend this account"
              : "This account is suspended"}
        </span>
        {confirming ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-full border border-[var(--color-border-strong)] px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className={clsx(
                "rounded-full px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60",
                active ? "bg-[var(--color-rose)]" : "bg-[var(--color-brand)]",
              )}
            >
              {pending ? "Saving…" : active ? "Deactivate" : "Reactivate"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={clsx(
              "rounded-full border px-3 py-1.5 text-sm",
              active
                ? "border-[color-mix(in_srgb,var(--color-rose)_40%,transparent)] text-[var(--color-rose)]"
                : "border-[var(--color-border-strong)] text-[var(--color-ink)]",
            )}
          >
            {active ? "Deactivate" : "Reactivate"}
          </button>
        )}
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-[var(--color-rose)]">
          {state.error}
        </p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function DrawerShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <OverlayPortal>
      <div className="fixed inset-0 z-[100] flex justify-end">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="relative flex h-full w-full max-w-md flex-col border-l border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-2xl"
        >
          <header className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <h2 id={titleId} className="truncate font-display text-lg font-semibold">
                {title}
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
          {children}
        </div>
      </div>
    </OverlayPortal>
  );
}

function DrawerFooter({ error, children }: { error?: string; children: ReactNode }) {
  return (
    <div className="space-y-3 border-t border-[var(--color-border)] px-5 py-4 sm:px-6">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-[color-mix(in_srgb,var(--color-rose)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-rose)_12%,transparent)] px-3 py-2 text-sm text-[var(--color-rose)]"
        >
          {error}
        </p>
      )}
      {children}
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
        {label}
        {required && <span className="text-[var(--color-rose)]"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-[var(--color-ink-faint)]">{hint}</span>}
    </label>
  );
}

function ProfileChecklist({
  profiles,
  selected,
  onToggle,
  disabled = false,
}: {
  profiles: ProfileChoice[];
  selected: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
        Permission profiles<span className="text-[var(--color-rose)]"> *</span>
      </legend>
      <p className="mb-2 text-xs text-[var(--color-ink-faint)]">
        Grants add up - someone holding two profiles gets the stronger of the two.
      </p>
      <div className="space-y-2">
        {profiles.map((profile) => (
          <label
            key={profile.id}
            className={clsx(
              "flex gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3",
              disabled ? "opacity-60" : "cursor-pointer hover:border-[var(--color-border-strong)]",
            )}
          >
            <input
              type="checkbox"
              checked={selected.includes(profile.id)}
              onChange={() => onToggle(profile.id)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{profile.name}</span>
              <span className="block text-xs text-[var(--color-ink-faint)]">{profile.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
