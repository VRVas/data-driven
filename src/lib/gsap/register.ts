"use client";

/**
 * Central GSAP setup. Import `gsap` from here (not from "gsap") anywhere you
 * animate, so plugins are registered exactly once and the brand eases are
 * available by name (`ease: "brand-snap"`).
 *
 * All GSAP plugins are free as of 3.13, so we can register the full toolkit.
 */
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollSmoother } from "gsap/ScrollSmoother";
import { SplitText } from "gsap/SplitText";
import { CustomEase } from "gsap/CustomEase";
import { CustomWiggle } from "gsap/CustomWiggle";
import { Flip } from "gsap/Flip";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";

import { curves, ease } from "@/lib/motion";

let registered = false;

function registerOnce() {
  if (registered || typeof window === "undefined") return;
  registered = true;

  gsap.registerPlugin(
    useGSAP,
    ScrollTrigger,
    ScrollSmoother,
    SplitText,
    CustomEase,
    CustomWiggle,
    Flip,
    MotionPathPlugin,
    DrawSVGPlugin,
    ScrollToPlugin,
  );

  // Register the named brand eases so `ease: "brand-snap"` resolves globally.
  (Object.keys(curves) as (keyof typeof curves)[]).forEach((name) => {
    const [x1, y1, x2, y2] = curves[name];
    CustomEase.create(ease[name], `M0,0 C${x1},${y1} ${x2},${y2} 1,1`);
  });

  // Respect reduced-motion globally: no smoothing, instant tweens.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    gsap.globalTimeline.timeScale(1e6);
  }
}

registerOnce();

export {
  gsap,
  useGSAP,
  ScrollTrigger,
  ScrollSmoother,
  SplitText,
  CustomEase,
  CustomWiggle,
  Flip,
  MotionPathPlugin,
  DrawSVGPlugin,
  ScrollToPlugin,
};
