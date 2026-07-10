"use client";

/**
 * Magnetic pointer-follow. Returns a ref to attach to any element; on hover the
 * element eases toward the cursor and springs back on leave. No-ops for
 * touch / reduced-motion users.
 */
import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/gsap/register";
import { ease } from "@/lib/motion";

export function useMagnetic<T extends HTMLElement = HTMLElement>(strength = 0.35) {
  const ref = useRef<T | null>(null);

  useGSAP(() => {
    const el = ref.current;
    if (!el) return;
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !window.matchMedia("(pointer: fine)").matches
    ) {
      return;
    }

    const xTo = gsap.quickTo(el, "x", { duration: 0.4, ease: ease.brandSettle });
    const yTo = gsap.quickTo(el, "y", { duration: 0.4, ease: ease.brandSettle });

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const relX = e.clientX - (r.left + r.width / 2);
      const relY = e.clientY - (r.top + r.height / 2);
      xTo(relX * strength);
      yTo(relY * strength);
    };
    const onLeave = () => {
      gsap.to(el, { x: 0, y: 0, duration: 0.6, ease: ease.brandSnap });
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [strength]);

  return ref;
}
