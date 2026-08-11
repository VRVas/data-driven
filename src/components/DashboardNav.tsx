"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

export const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/pipeline", label: "Pipeline" },
  { href: "/dashboard/companies", label: "Companies" },
  // Agents/agencies hidden from nav (we don't convert through them); /dashboard/agents still exists.
  { href: "/dashboard/scoring", label: "Scoring" },
  { href: "/dashboard/industries", label: "Industries" },
  { href: "/dashboard/whitespace", label: "Whitespace" },
  { href: "/dashboard/quality", label: "Data Quality" },
  { href: "/dashboard/copilot", label: "Copilot" },
];

/** Overview matches only its exact route; every other section also matches its
 *  nested pages (e.g. a lead detail keeps "Pipeline" lit). */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav data-tour="nav" className="hidden items-center gap-0.5 xl:flex">
      {NAV.map((n) => {
        const current = isActive(pathname, n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={current ? "page" : undefined}
            className={clsx(
              "whitespace-nowrap rounded-full px-2.5 py-1.5 text-[13px] transition-colors duration-300 ease-[var(--ease-brand-snap)]",
              current
                ? "bg-[color-mix(in_srgb,var(--color-frosted-canvas)_12%,transparent)] text-[var(--color-ink)]"
                : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
            )}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
