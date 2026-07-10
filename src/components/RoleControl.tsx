"use client";

import { useActionState } from "react";
import { clsx } from "clsx";
import { setUserRole, type TeamActionState } from "@/app/actions/team";
import type { UserRole } from "@/lib/auth/roles";

/** Segmented Admin / Member toggle that submits the role change. */
export function RoleControl({ userId, role }: { userId: string; role: UserRole }) {
  const [state, action, pending] = useActionState<TeamActionState, FormData>(setUserRole, undefined);

  return (
    <div className="flex items-center gap-3">
      <div className="inline-flex rounded-full border border-[var(--color-border-strong)] p-0.5">
        {(["admin", "member"] as UserRole[]).map((r) => {
          const active = r === role;
          return (
            <form key={r} action={action} className="contents">
              <input type="hidden" name="id" value={userId} />
              <input type="hidden" name="role" value={r} />
              <button
                type="submit"
                disabled={active || pending}
                className={clsx(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors duration-200",
                  active
                    ? "bg-[var(--color-frosted-canvas)] text-[var(--color-absolute-zero)]"
                    : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-50",
                )}
              >
                {r === "admin" ? "Admin" : "Member"}
              </button>
            </form>
          );
        })}
      </div>
      {state?.error && <span className="text-xs text-[var(--color-rose)]">{state.error}</span>}
    </div>
  );
}
