"use client";

import { useTour } from "@/components/tour/TourProvider";

/** "?" button in the top bar that (re)starts the guided product tour. */
export function TourLauncher() {
  const { start } = useTour();
  return (
    <button
      onClick={start}
      title="Tutorial - take the tour"
      aria-label="Start the tutorial"
      data-tour="launcher"
      className="hidden rounded-full border border-[var(--color-border-strong)] p-2 text-[var(--color-ink-muted)] transition-colors duration-300 hover:border-[var(--color-frosted-canvas)] hover:text-[var(--color-ink)] md:inline-flex"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
      </svg>
    </button>
  );
}
