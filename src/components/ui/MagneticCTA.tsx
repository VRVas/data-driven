"use client";

/**
 * MagneticCTA — the hero call-to-action. A signature violet→aqua gradient pill
 * with a mono label. The pill eases toward the cursor within a generous
 * magnetic zone, the label lags a touch behind for depth, and the trailing
 * arrow rides a CustomWiggle idle loop. Renders a Next `Link` or a `<button>`.
 * Fully static for reduced-motion users.
 */
import { useRef } from "react";
import Link from "next/link";
import clsx from "clsx";
import { gsap, useGSAP } from "@/lib/gsap/register";
import { ease } from "@/lib/motion";

interface Props {
  href?: string;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}

export function MagneticCTA({ href, onClick, className, children }: Props) {
  const zone = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLAnchorElement | HTMLButtonElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const arrow = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const z = zone.current;
      if (!z) return;
      if (
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        !window.matchMedia("(pointer: fine)").matches
      ) {
        return;
      }

      const bx = gsap.quickTo(btn.current, "x", { duration: 0.4, ease: ease.brandSettle });
      const by = gsap.quickTo(btn.current, "y", { duration: 0.4, ease: ease.brandSettle });
      const lx = gsap.quickTo(label.current, "x", { duration: 0.6, ease: ease.brandSettle });
      const ly = gsap.quickTo(label.current, "y", { duration: 0.6, ease: ease.brandSettle });

      // Idle arrow wiggle.
      const idle = gsap.to(arrow.current, {
        x: 4,
        duration: 0.9,
        ease: "wiggle({ wiggles: 6, type: easeOut })",
        repeat: -1,
        repeatDelay: 1.4,
      });

      const onMove = (e: PointerEvent) => {
        const r = z.getBoundingClientRect();
        const relX = e.clientX - (r.left + r.width / 2);
        const relY = e.clientY - (r.top + r.height / 2);
        bx(relX * 0.4);
        by(relY * 0.4);
        lx(relX * 0.12);
        ly(relY * 0.12);
      };
      const onLeave = () => {
        gsap.to([btn.current, label.current], {
          x: 0,
          y: 0,
          duration: 0.6,
          ease: ease.brandSnap,
          overwrite: "auto",
        });
      };

      z.addEventListener("pointermove", onMove);
      z.addEventListener("pointerleave", onLeave);
      return () => {
        z.removeEventListener("pointermove", onMove);
        z.removeEventListener("pointerleave", onLeave);
        idle.kill();
      };
    },
    { scope: zone },
  );

  const pill = clsx(
    "relative inline-flex items-center gap-2.5 rounded-full px-7 py-4",
    "font-mono text-[13px] uppercase tracking-[0.14em] text-[var(--color-absolute-zero)]",
    "shadow-[0_18px_50px_-18px_rgba(157,149,255,0.7)] will-change-transform",
    className,
  );
  const style = { background: "linear-gradient(114.41deg, #9d95ff 20.74%, #00bae2 65.5%)" };

  const inner = (
    <>
      <span ref={label} className="relative z-10 inline-flex items-center gap-2.5">
        {children}
      </span>
      <span ref={arrow} className="relative z-10 text-base leading-none">
        →
      </span>
    </>
  );

  return (
    <div ref={zone} className="inline-flex p-3">
      {href ? (
        <Link href={href} ref={btn as React.Ref<HTMLAnchorElement>} className={pill} style={style}>
          {inner}
        </Link>
      ) : (
        <button
          ref={btn as React.Ref<HTMLButtonElement>}
          onClick={onClick}
          className={pill}
          style={style}
        >
          {inner}
        </button>
      )}
    </div>
  );
}
