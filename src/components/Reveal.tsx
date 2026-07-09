"use client";

import { useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, useGSAP);
}

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** stagger children instead of the wrapper itself */
  stagger?: boolean;
  y?: number;
  delay?: number;
}

/**
 * Scroll-triggered entrance animation. Wrap any block; when it enters the
 * viewport it fades + rises into place. Respects reduced-motion.
 */
export function Reveal({ children, className, stagger = false, y = 24, delay = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce || !ref.current) return;

      const targets = stagger ? ref.current.children : ref.current;
      gsap.from(targets, {
        opacity: 0,
        y,
        duration: 0.9,
        delay,
        ease: "power3.out",
        stagger: stagger ? 0.08 : 0,
        scrollTrigger: {
          trigger: ref.current,
          start: "top 85%",
          once: true,
        },
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
