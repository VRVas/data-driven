"use client";

import { Children, cloneElement, useEffect, useId, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import FocusTrap from "focus-trap-react";

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
  const generatedId = useId();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!mounted) return null;
  const child = Children.only(children) as ReactElement<{ id?: string; tabIndex?: number }>;
  const id = child.props.id ?? generatedId;
  return createPortal(
    <FocusTrap focusTrapOptions={{ escapeDeactivates: false, allowOutsideClick: true, fallbackFocus: () => document.getElementById(id)! }}>
      {cloneElement(child, { id, tabIndex: child.props.tabIndex ?? -1 })}
    </FocusTrap>,
    document.body,
  );
}
