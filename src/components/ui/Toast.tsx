"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type ToastTone = "success" | "error";
interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}

const ToastCtx = createContext<(text: string, tone?: ToastTone) => void>(() => {});

/** Fire a transient toast: `const toast = useToast(); toast("Copied");`. */
export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((text: string, tone: ToastTone = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2200);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-6 z-[200] flex flex-col items-center gap-2"
        aria-live="polite"
        role="status"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="glass pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2 text-sm shadow-2xl"
          >
            <span style={{ color: t.tone === "error" ? "var(--color-rose)" : "var(--color-mint)" }}>
              {t.tone === "error" ? "✕" : "✓"}
            </span>
            <span className="text-[var(--color-ink)]">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
