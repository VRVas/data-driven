"use client";

import { useActionState, useState } from "react";
import { deleteProfile, type AccessActionState } from "@/app/actions/access";
import { ProfileEditor } from "@/components/access/ProfileEditor";
import { PERMISSION_KEYS } from "@/lib/auth/catalogue";
import { type Profile } from "@/lib/auth/profiles";

/** undefined = closed - profile null + duplicateOf null = creating from scratch */
type Drawer = { profile: Profile | null; duplicateOf: Profile | null };

export function ProfilesSection({
  profiles,
  canCreate = false,
  canUpdate = false,
  canDelete = false,
}: {
  profiles: Profile[];
  canCreate?: boolean;
  canUpdate?: boolean;
  canDelete?: boolean;
}) {
  const [drawer, setDrawer] = useState<Drawer | null>(null);

  return (
    <section className="glass overflow-hidden">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--color-border)] px-4 py-4 sm:px-6">
        <div>
          <div className="eyebrow mb-1">Permissions</div>
          <h2 className="font-display text-xl font-semibold tracking-tight">Permission profiles</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Reusable bundles of grants. Built-in profiles are fixed - duplicate one to make it yours.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setDrawer({ profile: null, duplicateOf: null })}
            className="rounded-full bg-[var(--color-brand)] px-4 py-1.5 text-sm font-semibold text-white"
          >
            New profile
          </button>
        )}
      </header>

      <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 sm:px-6">
        {profiles.map((profile) => {
          const granted = Object.keys(profile.permissions).length;
          return (
            <article
              key={profile.id}
              className="flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-base font-semibold">{profile.name}</h3>
                {profile.system && (
                  <span className="shrink-0 rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                    Built-in
                  </span>
                )}
              </div>

              <p className="mt-1 flex-1 text-sm text-[var(--color-ink-muted)]">{profile.description}</p>

              <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
                {profile.superuser
                  ? "Unrestricted - bypasses every permission check"
                  : `${granted} of ${PERMISSION_KEYS.length} permissions granted`}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDrawer({ profile, duplicateOf: null })}
                  disabled={profile.system || !canUpdate}
                  title={
                    profile.system
                      ? "Built-in profiles can't be edited - duplicate one instead."
                      : canUpdate
                        ? undefined
                        : "You don't have permission to edit profiles."
                  }
                  className="rounded-full border border-[var(--color-border-strong)] px-3 py-1.5 text-sm hover:border-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Edit
                </button>
                {canCreate && (
                  <button
                    type="button"
                    onClick={() => setDrawer({ profile: null, duplicateOf: profile })}
                    className="rounded-full border border-[var(--color-border-strong)] px-3 py-1.5 text-sm hover:border-[var(--color-brand)]"
                  >
                    Duplicate
                  </button>
                )}
                {canDelete && !profile.system && <DeleteProfileControl id={profile.id} />}
              </div>
            </article>
          );
        })}
      </div>

      {drawer && (
        <ProfileEditor
          profile={drawer.profile}
          duplicateOf={drawer.duplicateOf}
          onClose={() => setDrawer(null)}
        />
      )}
    </section>
  );
}

function DeleteProfileControl({ id }: { id: string }) {
  const [state, action, pending] = useActionState<AccessActionState, FormData>(deleteProfile, undefined);
  const [confirming, setConfirming] = useState(false);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {confirming ? (
        <>
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
            className="rounded-full bg-[var(--color-rose)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "Deleting…" : "Confirm delete"}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-full border border-[color-mix(in_srgb,var(--color-rose)_40%,transparent)] px-3 py-1.5 text-sm text-[var(--color-rose)]"
        >
          Delete
        </button>
      )}
      {state?.error && (
        <p role="alert" className="w-full text-xs text-[var(--color-rose)]">
          {state.error}
        </p>
      )}
    </form>
  );
}
