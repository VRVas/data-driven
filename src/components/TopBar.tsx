import Link from "next/link";
import { clsx } from "clsx";
import { auth, signOut } from "@/auth";

const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/pipeline", label: "Pipeline" },
  { href: "/dashboard/agents", label: "Agents" },
  { href: "/dashboard/scoring", label: "Scoring" },
  { href: "/dashboard/industries", label: "Industries" },
  { href: "/dashboard/quality", label: "Data Quality" },
];

export async function TopBar({ active }: { active?: string }) {
  const session = await auth();
  const user = session?.user;

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg)_78%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--color-brand)] font-display text-sm font-bold text-white shadow-[var(--shadow-glow)]">
            O
          </span>
          <span className="font-display text-[15px] font-semibold tracking-tight">
            OOVIE <span className="text-[var(--color-ink-muted)]">BD Intelligence</span>
          </span>
        </Link>

        {user && (
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={clsx(
                  "rounded-full px-3.5 py-1.5 text-sm transition-colors",
                  active === n.label
                    ? "bg-[var(--color-surface-2)] text-[var(--color-ink)]"
                    : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        )}

        {user ? (
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-[var(--color-ink-muted)] sm:inline">
              {user.name ?? user.email}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                className="rounded-full border border-[var(--color-border-strong)] px-4 py-1.5 text-sm font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface)]"
              >
                Sign out
              </button>
            </form>
          </div>
        ) : (
          <Link
            href="/login"
            className="rounded-full bg-[var(--color-ink)] px-4 py-1.5 text-sm font-medium text-[var(--color-bg)] transition-transform hover:scale-[1.03]"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
