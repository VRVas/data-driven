"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Renders a modal overlay into <body> and locks background scrolling.
 *
 * Portaling matters beyond z-index hygiene: ScrollSmoother puts a `transform`
 * on `#smooth-content`, and a transformed ancestor makes `position: fixed`
 * resolve against that element instead of the viewport - which would strand
 * drawers and the command palette mid-page.
 */
export function OverlayPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!mounted) return null;
  return createPortal(children, document.body);
}
