import { clsx } from "clsx";
import type { ReactNode } from "react";

export function Badge({
  children,
  color,
  className,
}: {
  children: ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
        className,
      )}
      style={
        color
          ? {
              color,
              borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
              background: `color-mix(in srgb, ${color} 12%, transparent)`,
            }
          : undefined
      }
    >
      {color && (
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden />
      )}
      {children}
    </span>
  );
}
