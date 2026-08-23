"use client";

/**
 * StatusPill - a compact live-status indicator: a softly pulsing dot beside a
 * mono, uppercase label inside a hairline pill. Used in headers and toolbars
 * to signal environment / data state (e.g. "LIVE", "LOCAL DATA").
 */
import { useRef } from "react";
import clsx from "clsx";
import { gsap, useGSAP } from "@/lib/gsap/register";

interface Props {
  label: string;
  color?: string;
  pulse?: boolean;
  className?: string;
}

export function StatusPill({ label, color = "var(--color-mint-burst)", pulse = true, className }: Props) {
  const dot = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      if (!pulse || !dot.current) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.to(dot.current, {
        opacity: 0.35,
        scale: 0.8,
        duration: 1.1,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
      });
    },
    { scope: dot },
  );

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1",
        "font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]",
        className,
      )}
      style={{ borderColor: "var(--color-border-strong)" }}
    >
      <span
        ref={dot}
        className="relative h-1.5 w-1.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px 1px ${color}` }}
        aria-hidden
      />
      {label}
    </span>
  );
}
