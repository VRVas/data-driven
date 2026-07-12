"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { TOUR_STEPS, type TourStep } from "@/lib/tour/steps";

const DONE_KEY = "oovie.tour.v1.done";
const PAD = 8;
const CARD_W = 340;

interface TourContextValue {
  start: () => void;
  isActive: boolean;
}

const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used within <TourProvider>");
  return ctx;
}

export function TourProvider({
  children,
  autoStart = false,
}: {
  children: React.ReactNode;
  autoStart?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const startedRef = useRef(false);

  useEffect(() => setMounted(true), []);

  const step: TourStep | undefined = TOUR_STEPS[index];

  const stop = useCallback((completed: boolean) => {
    setActive(false);
    setRect(null);
    if (completed) {
      try {
        localStorage.setItem(DONE_KEY, "1");
      } catch {
        /* ignore */
      }
    }
  }, []);

  const start = useCallback(() => {
    setRect(null);
    setIndex(0);
    setActive(true);
  }, []);

  const go = useCallback(
    (next: number) => {
      if (next < 0) return;
      if (next >= TOUR_STEPS.length) {
        stop(true);
        return;
      }
      setRect(null);
      setIndex(next);
    },
    [stop],
  );

  // Route to the current step's page (start/go stay stable; routing lives here).
  useEffect(() => {
    if (!active || !step) return;
    if (step.route !== pathname) router.push(step.route);
  }, [active, step, pathname, router]);

  // Auto-start once for first-time users.
  useEffect(() => {
    if (!autoStart || !mounted || startedRef.current) return;
    let done = "0";
    try {
      done = localStorage.getItem(DONE_KEY) ?? "0";
    } catch {
      /* ignore */
    }
    if (done === "1") return;
    startedRef.current = true;
    const t = setTimeout(() => start(), 900);
    return () => clearTimeout(t);
  }, [autoStart, mounted, start]);

  // Locate the anchor for the current step (after any route change settles).
  useEffect(() => {
    if (!active || !step) return;
    if (step.route !== pathname) return; // wait for navigation to complete
    if (!step.selector) {
      setRect(null); // centered card
      return;
    }

    let cancelled = false;
    let raf = 0;
    const startedAt = Date.now();

    const tick = () => {
      if (cancelled) return;
      const el = document.querySelector(step.selector as string) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
        window.setTimeout(() => {
          if (!cancelled) setRect(el.getBoundingClientRect());
        }, 340);
        return;
      }
      if (Date.now() - startedAt > 4000) {
        if (step.optional) go(index + 1);
        else setRect(null);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [active, step, pathname, index, go]);

  // Keep the spotlight aligned while scrolling/resizing.
  useEffect(() => {
    if (!active || !step?.selector) return;
    const update = () => {
      const el = document.querySelector(step.selector as string) as HTMLElement | null;
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [active, step]);

  // Keyboard controls.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop(false);
      else if (e.key === "ArrowRight" || e.key === "Enter") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, index, go, stop]);

  const value = useMemo<TourContextValue>(() => ({ start, isActive: active }), [start, active]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {mounted &&
        active &&
        step &&
        createPortal(
          <TourOverlay
            step={step}
            index={index}
            total={TOUR_STEPS.length}
            rect={rect}
            onNext={() => go(index + 1)}
            onPrev={() => go(index - 1)}
            onClose={() => stop(true)}
          />,
          document.body,
        )}
    </TourContext.Provider>
  );
}

function TourOverlay({
  step,
  index,
  total,
  rect,
  onNext,
  onPrev,
  onClose,
}: {
  step: TourStep;
  index: number;
  total: number;
  rect: DOMRect | null;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(0);

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [step, rect]);

  const hole =
    rect && rect.width > 0
      ? {
          top: rect.top - PAD,
          left: rect.left - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
        }
      : null;

  const card = cardPosition(hole, step.placement, cardH);
  const isLast = index === total - 1;

  return (
    <div className="fixed inset-0 z-[300]" role="dialog" aria-modal="true" aria-label="Product tour">
      {/* Dim + spotlight */}
      {hole ? (
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
            borderRadius: 14,
            boxShadow: "0 0 0 9999px rgba(3,5,20,0.74)",
            outline: "1.5px solid color-mix(in srgb, var(--color-brand) 70%, transparent)",
            transition: "all 0.35s cubic-bezier(0.22,1,0.36,1)",
            pointerEvents: "none",
          }}
        />
      ) : (
        <div aria-hidden style={{ position: "fixed", inset: 0, background: "rgba(3,5,20,0.74)" }} />
      )}

      {/* Card */}
      <div
        ref={cardRef}
        className="glass fixed w-[340px] max-w-[calc(100vw-24px)] rounded-2xl p-5 shadow-2xl"
        style={{
          top: card.top,
          left: card.left,
          transition: "top 0.35s cubic-bezier(0.22,1,0.36,1), left 0.35s cubic-bezier(0.22,1,0.36,1)",
          border: "1px solid color-mix(in srgb, var(--color-brand) 30%, var(--color-border))",
        }}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-brand-bright)]">
            {index + 1} / {total}
          </span>
          <button
            onClick={onClose}
            aria-label="End tour"
            className="text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
          >
            ✕
          </button>
        </div>

        <h3 className="font-display text-lg font-semibold text-[var(--color-ink)]">{step.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-muted)]">{step.body}</p>

        {step.sheet && (
          <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-brand)_7%,transparent)] px-3 py-2">
            <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-ink-faint)]">
              From the sheet
            </div>
            <div className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{step.sheet}</div>
          </div>
        )}

        {/* Progress dots */}
        <div className="mt-4 flex items-center gap-1" aria-hidden>
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className="h-1 rounded-full transition-all"
              style={{
                width: i === index ? 16 : 6,
                background:
                  i === index
                    ? "var(--color-brand)"
                    : i < index
                      ? "color-mix(in srgb, var(--color-brand) 45%, transparent)"
                      : "var(--color-border-strong)",
              }}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={onClose}
            className="text-xs text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button
                onClick={onPrev}
                className="rounded-full border border-[var(--color-border-strong)] px-3.5 py-1.5 text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
              >
                Back
              </button>
            )}
            <button
              onClick={onNext}
              className="rounded-full bg-[var(--color-brand)] px-4 py-1.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03]"
            >
              {isLast ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Position the card near the spotlight (or center when there's no anchor). */
function cardPosition(
  hole: { top: number; left: number; width: number; height: number } | null,
  placement: TourStep["placement"],
  cardH: number,
): { top: number; left: number } {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const h = cardH || 220;
  const gap = 14;
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  if (!hole || placement === "center") {
    return { top: clamp((vh - h) / 2, 12, vh - h - 12), left: clamp((vw - CARD_W) / 2, 12, vw - CARD_W - 12) };
  }

  let top: number;
  let left: number;
  switch (placement) {
    case "top":
      top = hole.top - h - gap;
      left = hole.left + hole.width / 2 - CARD_W / 2;
      break;
    case "left":
      top = hole.top + hole.height / 2 - h / 2;
      left = hole.left - CARD_W - gap;
      break;
    case "right":
      top = hole.top + hole.height / 2 - h / 2;
      left = hole.left + hole.width + gap;
      break;
    case "bottom":
    default:
      top = hole.top + hole.height + gap;
      left = hole.left + hole.width / 2 - CARD_W / 2;
      break;
  }

  // If the preferred side overflows, flip vertically to stay on-screen.
  if (top < 12) top = hole.top + hole.height + gap;
  if (top + h > vh - 12) top = Math.max(12, hole.top - h - gap);

  return {
    top: clamp(top, 12, vh - h - 12),
    left: clamp(left, 12, vw - CARD_W - 12),
  };
}
