import { clsx } from "clsx";
import { ADMIN_PROFILE_ID } from "@/lib/auth/profiles";

/** Compact profile chip. The administrator profile is tinted so it stands out in a list. */
export function ProfilePill({ id, name, className }: { id: string; name: string; className?: string }) {
  const isAdmin = id === ADMIN_PROFILE_ID;
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5",
        isAdmin
          ? "border-[color-mix(in_srgb,var(--color-brand)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-brand)_14%,transparent)] text-[var(--color-brand)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink-muted)]",
        className,
      )}
    >
      {name}
    </span>
  );
}
