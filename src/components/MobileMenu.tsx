"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { NAV, isActive } from "./DashboardNav";
import { useTour } from "@/components/tour/TourProvider";

const COMMAND_EVENT = "oovie:command-palette";

interface MenuUser {
  name?: string | null;
  email?: string | null;
  /** Resolved from the profiles the user holds, not the legacy role claim. */
  access: { label: string; elevated: boolean };
}

/**
 * Compact top-bar menu for viewports below `xl`, where the full horizontal nav
 * and action icons don't fit. A hamburger opens a portaled slide-in drawer with
 * navigation, tools (reminders/outbox/activity/team/tutorial) and the account
 * controls. Portaled to `document.body` so it stacks above everything and is
 * unaffected by any transformed scroll container.
 */
export function MobileMenu({
  user,
  isAdmin,
  dueCount,
  pendingOutreach,
  tour = false,
  signOutAction,
}: {
  user: MenuUser;
  isAdmin: boolean;
  dueCount: number;
  pendingOutreach: number;
  tour?: boolean;
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => setMounted(true), []);
  // Close whenever the route changes (a nav link was tapped).
  useEffect(() => setOpen(false), [pathname]);
  // Lock body scroll and wire Escape while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="inline-flex items-center justify-center rounded-full border border-[var(--color-border-strong)] p-2 text-[var(--color-ink-muted)] transition-colors duration-300 hover:border-[var(--color-frosted-canvas)] hover:text-[var(--color-ink)] lg:hidden"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>

      {mounted &&
        open &&
        createPortal(
          <div className="fixed inset-0 z-[200] lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <div
              className="absolute inset-0 bg-[rgba(3,5,20,0.6)] backdrop-blur-sm"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <div className="absolute right-0 top-0 flex h-full w-[min(20rem,86vw)] flex-col border-l border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-absolute-zero)_95%,transparent)] shadow-2xl backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
                <span className="eyebrow">Menu</span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="rounded-full p-1 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-4">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    window.dispatchEvent(new Event(COMMAND_EVENT));
                  }}
                  className="mb-2 flex w-full items-center gap-2 rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-sm text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-frosted-canvas)] hover:text-[var(--color-ink)]"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="11" cy="11" r="7" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  Search &amp; commands
                </button>

                <div className="eyebrow px-2 pb-1 pt-4">Navigate</div>
                {NAV.map((n) => {
                  const current = isActive(pathname, n.href);
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      aria-current={current ? "page" : undefined}
                      className={clsx(
                        "block rounded-lg px-3 py-2 text-sm transition-colors",
                        current
                          ? "bg-[color-mix(in_srgb,var(--color-frosted-canvas)_12%,transparent)] text-[var(--color-ink)]"
                          : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]",
                      )}
                    >
                      {n.label}
                    </Link>
                  );
                })}

                <div className="eyebrow px-2 pb-1 pt-4">Tools</div>
                <MenuRow href="/dashboard/reminders" label="Reminders" badge={dueCount} badgeColor="var(--color-rose)" pathname={pathname} />
                <MenuRow href="/dashboard/outbox" label="Outbox" badge={pendingOutreach} badgeColor="var(--color-amber)" pathname={pathname} />
                {isAdmin && <MenuRow href="/dashboard/activity" label="Activity" pathname={pathname} />}
                {isAdmin && <MenuRow href="/dashboard/team" label="Team & roles" pathname={pathname} />}
                {tour && <TourMenuItem onStart={() => setOpen(false)} />}
              </div>

              <div className="border-t border-[var(--color-border)] px-5 py-4">
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className="max-w-[12rem] truncate rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]"
                    style={{
                      borderColor: user.access.elevated
                        ? "color-mix(in srgb, var(--color-digital-violet) 55%, transparent)"
                        : "var(--color-border-strong)",
                      color: user.access.elevated ? "var(--color-digital-violet)" : "var(--color-ink-faint)",
                    }}
                  >
                    {user.access.label}
                  </span>
                  <span className="truncate font-mono text-xs text-[var(--color-ink-muted)]">
                    {user.name ?? user.email}
                  </span>
                </div>
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className="w-full rounded-full border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-frosted-canvas)] hover:bg-[var(--color-frosted-canvas)] hover:text-[var(--color-absolute-zero)]"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function MenuRow({
  href,
  label,
  badge = 0,
  badgeColor,
  pathname,
}: {
  href: string;
  label: string;
  badge?: number;
  badgeColor?: string;
  pathname: string;
}) {
  const current = isActive(pathname, href);
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={clsx(
        "flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
        current
          ? "bg-[color-mix(in_srgb,var(--color-frosted-canvas)_12%,transparent)] text-[var(--color-ink)]"
          : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]",
      )}
    >
      <span>{label}</span>
      {badge > 0 && (
        <span
          className="grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[10px] font-semibold text-[var(--color-absolute-zero)]"
          style={{ background: badgeColor ?? "var(--color-brand)" }}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </Link>
  );
}

/** Rendered only under the dashboard (tour=true), which is inside TourProvider. */
function TourMenuItem({ onStart }: { onStart: () => void }) {
  const { start } = useTour();
  return (
    <button
      type="button"
      onClick={() => {
        onStart();
        start();
      }}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
      </svg>
      Tutorial - take the tour
    </button>
  );
}
