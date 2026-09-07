"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * A titled panel that holds a chart, and can be folded away.
 *
 * Two jobs that had to be solved together. Every dashboard had its own local
 * Panel, so paired cards in a two-column grid were sized by their contents and
 * never lined up. And a chart you have finished reading is just wasted screen.
 *
 * Open, the card fills its grid row, which is what makes a pair equal height;
 * collapsed it drops h-full and sits at the top of the row, because a folded
 * card stretched to the height of its open neighbour is a large empty box.
 *
 * The body unmounts rather than hiding, so a chart that animates in replays
 * from a clean slate. Hiding it with display:none leaves the SVG in the layout
 * at zero size, and the scroll trigger that paints the dots measures that.
 */
const storageKey = (id: string) => `oovie.panel.${id}`;

export function ChartCard({
  id,
  title,
  subtitle,
  tour,
  action,
  className,
  children,
}: {
  /** Stable per panel: the collapsed preference is remembered against it. */
  id: string;
  title: string;
  subtitle?: ReactNode;
  tour?: string;
  /** Anything that belongs beside the fold control, e.g. an export menu. */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  // Always open on the first paint: the server cannot read localStorage, and a
  // different first render on the client is a hydration mismatch.
  const [open, setOpen] = useState(true);

  useEffect(() => {
    setOpen(window.localStorage.getItem(storageKey(id)) !== "0");
  }, [id]);

  const toggle = () => {
    setOpen((was) => {
      const next = !was;
      try {
        window.localStorage.setItem(storageKey(id), next ? "1" : "0");
      } catch {
        // Private mode, or storage full. The fold still works for this visit.
      }
      return next;
    });
  };

  const bodyId = `${id}-body`;
  const label = `${open ? "Collapse" : "Expand"} ${title}`;

  return (
    <section
      data-tour={tour}
      data-panel={id}
      className={`glass flex flex-col p-6 ${open ? "h-full" : ""} ${className ?? ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={label}
            title={label}
            className="rounded-full border border-[var(--color-border-strong)] p-1.5 text-[var(--color-ink-faint)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-ink)]"
          >
            <svg
              viewBox="0 0 20 20"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s ease" }}
            >
              <path d="M5 8l5 5 5-5" />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div id={bodyId} className="mt-5 flex min-h-0 flex-1 flex-col justify-center">
          {children}
        </div>
      )}
    </section>
  );
}
