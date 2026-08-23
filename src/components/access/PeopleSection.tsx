"use client";

import { useState } from "react";
import { ProfilePill } from "@/components/access/ProfilePill";
import {
  AssignAccessDrawer,
  CreatePersonDrawer,
  type AccessPerson,
  type ProfileChoice,
} from "@/components/access/UserAccessDrawer";

export function PeopleSection({
  people,
  profiles,
  canCreate = false,
  canAssign = false,
  canDeactivate = false,
}: {
  people: AccessPerson[];
  profiles: ProfileChoice[];
  canCreate?: boolean;
  canAssign?: boolean;
  canDeactivate?: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState<AccessPerson | null>(null);

  return (
    <section className="glass overflow-hidden">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--color-border)] px-4 py-4 sm:px-6">
        <div>
          <div className="eyebrow mb-1">Accounts</div>
          <h2 className="font-display text-xl font-semibold tracking-tight">People</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Everyone with a sign-in, and the profiles that decide what they can do.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-full bg-[var(--color-brand)] px-4 py-1.5 text-sm font-semibold text-white"
          >
            New person
          </button>
        )}
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--color-border)]">
            <tr className="text-left">
              <th className="eyebrow px-4 py-3 sm:px-6">Name</th>
              <th className="eyebrow hidden px-4 py-3 sm:table-cell sm:px-6">Email</th>
              <th className="eyebrow hidden px-4 py-3 md:table-cell sm:px-6">Profiles</th>
              <th className="eyebrow px-4 py-3 sm:px-6">Status</th>
              <th className="eyebrow px-4 py-3 text-right sm:px-6">Access</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.id} className="border-t border-[var(--color-border)] align-top">
                <td className="px-4 py-3 sm:px-6">
                  <div className="font-medium">
                    {person.name}
                    {person.isSelf && <span className="ml-2 text-xs text-[var(--color-ink-faint)]">you</span>}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-[var(--color-ink-faint)] sm:hidden">
                    {person.email}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1 md:hidden">
                    {person.profiles.map((p) => (
                      <ProfilePill key={p.id} id={p.id} name={p.name} />
                    ))}
                  </div>
                </td>
                <td className="hidden px-4 py-3 font-mono text-xs text-[var(--color-ink-muted)] sm:table-cell sm:px-6">
                  {person.email}
                </td>
                <td className="hidden px-4 py-3 md:table-cell sm:px-6">
                  <div className="flex flex-wrap gap-1">
                    {person.profiles.length === 0 ? (
                      <span className="text-[var(--color-ink-faint)]">-</span>
                    ) : (
                      person.profiles.map((p) => <ProfilePill key={p.id} id={p.id} name={p.name} />)
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 sm:px-6">
                  {person.active ? (
                    <span className="text-xs text-[var(--color-ink-faint)]">Active</span>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-ink-faint)]">
                      Inactive
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right sm:px-6">
                  <button
                    type="button"
                    onClick={() => setAssigning(person)}
                    disabled={!canAssign}
                    title={canAssign ? undefined : "You don't have permission to change access."}
                    className="rounded-full border border-[var(--color-border-strong)] px-3 py-1.5 text-sm hover:border-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Access
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && <CreatePersonDrawer profiles={profiles} onClose={() => setCreating(false)} />}
      {assigning && (
        <AssignAccessDrawer
          person={assigning}
          profiles={profiles}
          canDeactivate={canDeactivate}
          onClose={() => setAssigning(null)}
        />
      )}
    </section>
  );
}
