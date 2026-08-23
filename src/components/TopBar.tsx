import Link from "next/link";
import { auth, signOut } from "@/auth";
import { DashboardNav } from "./DashboardNav";
import { MobileMenu } from "./MobileMenu";
import { TourLauncher } from "@/components/tour/TourLauncher";
import { CommandButton } from "@/components/CommandPalette";
import { getVisibleBrands } from "@/lib/leads/visible";
import { capabilities } from "@/lib/auth/authorize";
import { followUpsFrom, countDue } from "@/lib/leads/followups";
import { getNotificationStore } from "@/lib/store/notifications";
import { getOutreachStore } from "@/lib/store/outreach";

export async function TopBar({ tour = false, fixed = false }: { tour?: boolean; fixed?: boolean } = {}) {
  const session = await auth();
  const user = session?.user;

  let dueCount = 0;
  let pendingOutreach = 0;
  const caps = user
    ? await capabilities(["audit:read", "user:read", "outreach:send"] as const)
    : { "audit:read": false, "user:read": false, "outreach:send": false };
  if (user) {
    try {
      // The bell counts anything wanting attention: follow-ups that are due,
      // and reminders that have already fired and not been dismissed.
      dueCount = countDue(followUpsFrom(await getVisibleBrands()));
    } catch {
      dueCount = 0;
    }
    try {
      const unread = (await getNotificationStore().listForUser(user.id as string, 50)).filter((n) => !n.readAt);
      dueCount += unread.length;
    } catch {
      // A notification store that is unavailable must not blank the top bar.
    }
    if (caps["outreach:send"]) {
      try {
        pendingOutreach = (await getOutreachStore().list(300)).filter((o) => o.status === "pending_approval").length;
      } catch {
        pendingOutreach = 0;
      }
    }
  }

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <header className={`${fixed ? "fixed inset-x-0" : "sticky"} top-0 z-50 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-absolute-zero)_72%,transparent)] backdrop-blur-xl`}>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg font-display text-sm font-bold text-[var(--color-absolute-zero)] transition-transform duration-300 ease-[var(--ease-brand-snap)] group-hover:-rotate-6"
            style={{ background: "linear-gradient(114.41deg, #9d95ff 20.74%, #00bae2 65.5%)" }}
          >
            O
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-display text-[15px] font-semibold tracking-tight">OOVIE</span>
            <span className="mt-0.5 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-faint)]">
              BD Intelligence
            </span>
          </span>
        </Link>

        {user && (
          <DashboardNav />
        )}

        {user ? (
          <>
          <div className="hidden items-center gap-2 xl:flex">
            <CommandButton />
            {tour && <TourLauncher />}
            <Link
              href="/dashboard/reminders"
              title="Reminders"
              data-tour="topbar-reminders"
              aria-label={`Reminders${dueCount > 0 ? ` (${dueCount} due)` : ""}`}
              className="relative hidden rounded-full border border-[var(--color-border-strong)] p-2 text-[var(--color-ink-muted)] transition-colors duration-300 hover:border-[var(--color-frosted-canvas)] hover:text-[var(--color-ink)] md:inline-flex"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {dueCount > 0 && (
                <span
                  className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold text-[var(--color-absolute-zero)]"
                  style={{ background: "var(--color-rose)" }}
                >
                  {dueCount > 9 ? "9+" : dueCount}
                </span>
              )}
            </Link>
            <Link
              href="/dashboard/outbox"
              title="Outbox"
              data-tour="topbar-outbox"
              aria-label={`Outbox${pendingOutreach > 0 ? ` (${pendingOutreach} awaiting approval)` : ""}`}
              className="relative hidden rounded-full border border-[var(--color-border-strong)] p-2 text-[var(--color-ink-muted)] transition-colors duration-300 hover:border-[var(--color-frosted-canvas)] hover:text-[var(--color-ink)] md:inline-flex"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m22 6-10 7L2 6" />
              </svg>
              {pendingOutreach > 0 && (
                <span
                  className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold text-[var(--color-absolute-zero)]"
                  style={{ background: "var(--color-amber)" }}
                >
                  {pendingOutreach > 9 ? "9+" : pendingOutreach}
                </span>
              )}
            </Link>
            {caps["audit:read"] && (
              <Link
                href="/dashboard/activity"
                title="Activity - audit trail"
                data-tour="topbar-activity"
                aria-label="Activity - audit trail"
                className="hidden rounded-full border border-[var(--color-border-strong)] p-2 text-[var(--color-ink-muted)] transition-colors duration-300 hover:border-[var(--color-frosted-canvas)] hover:text-[var(--color-ink)] md:inline-flex"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
              </Link>
            )}
            {caps["user:read"] && (
              <Link
                href="/dashboard/team"
                title="Team & roles"
                data-tour="topbar-team"
                aria-label="Team & roles"
                className="hidden rounded-full border border-[var(--color-border-strong)] p-2 text-[var(--color-ink-muted)] transition-colors duration-300 hover:border-[var(--color-frosted-canvas)] hover:text-[var(--color-ink)] md:inline-flex"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </Link>
            )}
            <span className="hidden items-center gap-2 sm:flex">
              <span
                className="rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]"
                style={{
                  borderColor: user.role === "admin" ? "color-mix(in srgb, var(--color-digital-violet) 55%, transparent)" : "var(--color-border-strong)",
                  color: user.role === "admin" ? "var(--color-digital-violet)" : "var(--color-ink-faint)",
                }}
              >
                {user.role === "admin" ? "Admin" : "Member"}
              </span>
              <span className="hidden whitespace-nowrap font-mono text-xs text-[var(--color-ink-muted)] 2xl:inline">{user.name ?? user.email}</span>
            </span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="whitespace-nowrap rounded-full border border-[var(--color-border-strong)] px-4 py-1.5 text-sm font-medium text-[var(--color-ink)] transition-colors duration-300 ease-[var(--ease-brand-snap)] hover:border-[var(--color-frosted-canvas)] hover:bg-[var(--color-frosted-canvas)] hover:text-[var(--color-absolute-zero)]"
              >
                Sign out
              </button>
            </form>
          </div>
          <MobileMenu
            user={{ name: user.name, email: user.email, role: user.role }}
            isAdmin={caps["user:read"]}
            dueCount={dueCount}
            pendingOutreach={pendingOutreach}
            tour={tour}
            signOutAction={signOutAction}
          />
          </>
        ) : (
          <Link
            href="/login"
            className="rounded-full bg-[var(--color-frosted-canvas)] px-4 py-1.5 text-sm font-medium text-[var(--color-absolute-zero)] transition-transform duration-300 ease-[var(--ease-brand-snap)] hover:scale-[1.04]"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
