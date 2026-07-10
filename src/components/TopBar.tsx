import Link from "next/link";
import { clsx } from "clsx";
import { auth, signOut } from "@/auth";

const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/pipeline", label: "Pipeline" },
  { href: "/dashboard/agents", label: "Agents" },
  { href: "/dashboard/scoring", label: "Scoring" },
  { href: "/dashboard/industries", label: "Industries" },
  { href: "/dashboard/whitespace", label: "Whitespace" },
  { href: "/dashboard/quality", label: "Data Quality" },
];

export async function TopBar({ active }: { active?: string }) {
  const session = await auth();
  const user = session?.user;

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-absolute-zero)_72%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <span
            className="grid h-8 w-8 place-items-center rounded-lg font-display text-sm font-bold text-[var(--color-absolute-zero)] transition-transform duration-300 ease-[var(--ease-brand-snap)] group-hover:-rotate-6"
            style={{ background: "linear-gradient(114.41deg, #9d95ff 20.74%, #00bae2 65.5%)" }}
          >
            O
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-display text-[15px] font-semibold tracking-tight">OOVIE</span>
            <span className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-faint)]">
              BD Intelligence
            </span>
          </span>
        </Link>

        {user && (
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={clsx(
                  "rounded-full px-3.5 py-1.5 text-sm transition-colors duration-300 ease-[var(--ease-brand-snap)]",
                  active === n.label
                    ? "bg-[color-mix(in_srgb,var(--color-frosted-canvas)_12%,transparent)] text-[var(--color-ink)]"
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
            <span className="hidden font-mono text-xs text-[var(--color-ink-muted)] sm:inline">
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
                className="rounded-full border border-[var(--color-border-strong)] px-4 py-1.5 text-sm font-medium text-[var(--color-ink)] transition-colors duration-300 ease-[var(--ease-brand-snap)] hover:border-[var(--color-frosted-canvas)] hover:bg-[var(--color-frosted-canvas)] hover:text-[var(--color-absolute-zero)]"
              >
                Sign out
              </button>
            </form>
          </div>
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
