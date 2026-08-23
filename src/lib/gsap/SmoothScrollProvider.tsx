"use client";

/**
 * ScrollSmoother wrapper. Wrap the page content in
 * `<div id="smooth-wrapper"><div id="smooth-content">…</div></div>`.
 *
 * Smoothing is enabled only on pointer-fine, no-reduced-motion viewports, so
 * touch devices and reduced-motion users keep native scrolling. The smoother is
 * refreshed on route change so ScrollTriggers re-measure the new page.
 *
 * Anything `position: fixed` (top bar, drawers, palette, toasts) must live
 * OUTSIDE this wrapper - the transform on `#smooth-content` would otherwise
 * become its containing block.
 */
import { useRef } from "react";
import { usePathname } from "next/navigation";
import { gsap, useGSAP, ScrollSmoother, ScrollTrigger } from "@/lib/gsap/register";

export function SmoothScrollProvider({ children }: { children: React.ReactNode }) {
  const smoother = useRef<ScrollSmoother | null>(null);
  const pathname = usePathname();

  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add(
      "(min-width: 1024px) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
      () => {
        smoother.current = ScrollSmoother.create({
          wrapper: "#smooth-wrapper",
          content: "#smooth-content",
          smooth: 1.2,
          effects: true,
          // Left off on purpose: it intercepts wheel input, which would starve
          // nested scrollers (chat transcript, wide tables).
          normalizeScroll: false,
          ignoreMobileResize: true,
        });
        return () => {
          smoother.current?.kill();
          smoother.current = null;
        };
      },
    );
    return () => mm.revert();
  }, []);

  // Re-measure after route transitions, once the new page has painted.
  useGSAP(() => {
    smoother.current?.scrollTo(0, false);
    const id = requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => cancelAnimationFrame(id);
  }, [pathname]);

  return (
    <div id="smooth-wrapper">
      <div id="smooth-content">{children}</div>
    </div>
  );
}
