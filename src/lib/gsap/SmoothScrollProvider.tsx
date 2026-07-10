"use client";

/**
 * ScrollSmoother wrapper. Wrap the app content in
 * `<div id="smooth-wrapper"><div id="smooth-content">…</div></div>`.
 *
 * Smoothing is enabled only on pointer-fine, no-reduced-motion viewports, so
 * touch devices and reduced-motion users keep native scrolling. The smoother
 * is refreshed on route change so ScrollTriggers re-measure the new page.
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
          normalizeScroll: true,
        });
        return () => {
          smoother.current?.kill();
          smoother.current = null;
        };
      },
    );
    return () => mm.revert();
  }, []);

  // Re-measure after route transitions.
  useGSAP(() => {
    smoother.current?.scrollTo(0, false);
    ScrollTrigger.refresh();
  }, [pathname]);

  return (
    <div id="smooth-wrapper">
      <div id="smooth-content">{children}</div>
    </div>
  );
}
