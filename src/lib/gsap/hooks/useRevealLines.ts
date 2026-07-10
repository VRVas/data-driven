"use client";

/**
 * Line-by-line reveal. Splits the target's text into masked lines that rise
 * into place on scroll. Attach the returned ref to a heading or paragraph.
 * Reduced-motion users see the text immediately (no split, no transform).
 */
import { useRef } from "react";
import { gsap, useGSAP, SplitText, ScrollTrigger } from "@/lib/gsap/register";
import { ease, staggers, durations } from "@/lib/motion";

export function useRevealLines<T extends HTMLElement = HTMLElement>(
  opts: { stagger?: number; start?: string; delay?: number } = {},
) {
  const ref = useRef<T | null>(null);
  const { stagger = staggers.normal, start = "top 85%", delay = 0 } = opts;

  useGSAP(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.set(el, { autoAlpha: 1 });
      return;
    }

    const split = new SplitText(el, {
      type: "lines",
      linesClass: "reveal-line",
      mask: "lines",
    });

    gsap.set(el, { autoAlpha: 1 });
    const tween = gsap.from(split.lines, {
      yPercent: 115,
      duration: durations.medium,
      ease: ease.brandSnap,
      stagger,
      delay,
      scrollTrigger: { trigger: el, start },
    });

    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
      split.revert();
    };
  }, []);

  return ref;
}
