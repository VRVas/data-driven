"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OverlayPortal } from "@/components/ui/OverlayPortal";
import { useTour } from "@/components/tour/TourProvider";

const OPEN_EVENT = "oovie:command-palette";

interface Lead {
  id: string;
  name: string;
}

interface Command {
  id: string;
  label: string;
  group: "Leads" | "Navigate" | "Actions";
  hint?: string;
  keywords?: string;
  run: () => void;
}

/** Top-bar button that opens the command palette (also bound to ⌘K / Ctrl-K). */
export function CommandButton() {
  const [mod, setMod] = useState("⌘");
  useEffect(() => {
    const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!isMac) setMod("Ctrl ");
  }, []);
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      title="Command palette"
      aria-label="Open command palette"
      data-tour="command"
      className="hidden items-center gap-2 rounded-full border border-[var(--color-border-strong)] py-1.5 pl-3 pr-2 text-sm text-[var(--color-ink-muted)] transition-colors duration-300 hover:border-[var(--color-frosted-canvas)] hover:text-[var(--color-ink)] md:inline-flex"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <span className="hidden 2xl:inline">Search</span>
      <kbd className="rounded border border-[var(--color-border-strong)] px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-[var(--color-ink-faint)]">
        {mod}K
      </kbd>
    </button>
  );
}

/**
 * ⌘K / Ctrl-K command palette. Jump to any section, search leads by name, or
 * run a quick action (ask the copilot, replay the tutorial, sign out).
 * Mounted once in the dashboard layout.
 */
export function CommandPalette({
  leads,
  isAdmin,
  signOutAction,
}: {
  leads: Lead[];
  isAdmin: boolean;
  signOutAction: () => Promise<void>;
}) {
  const router = useRouter();
  const { start } = useTour();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  // Global open: ⌘K / Ctrl-K toggles, and the top-bar button dispatches an event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  // Focus the input when opened (OverlayPortal handles the scroll lock).
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const nav: [string, string, string?][] = [
      ["/dashboard", "Overview"],
      ["/dashboard/pipeline", "Pipeline", "leads crm"],
      ["/dashboard/companies", "Companies", "accounts clients repeat revenue"],
      ["/dashboard/scoring", "Scoring", "score quadrant"],
      ["/dashboard/industries", "Industries", "sectors"],
      ["/dashboard/whitespace", "Whitespace & opportunity", "tam market sizing"],
      ["/dashboard/quality", "Data quality"],
      ["/dashboard/copilot", "Copilot", "chat ai assistant"],
      ["/dashboard/reminders", "Reminders", "follow up due"],
      ["/dashboard/outbox", "Outbox", "email outreach"],
    ];
    const list: Command[] = nav.map(([href, label, keywords]) => ({
      id: `nav:${href}`,
      label,
      group: "Navigate",
      hint: "Go",
      keywords,
      run: () => router.push(href),
    }));
    if (isAdmin) {
      list.push(
        { id: "nav:/dashboard/activity", label: "Activity", group: "Navigate", hint: "Go", keywords: "audit trail", run: () => router.push("/dashboard/activity") },
        { id: "nav:/dashboard/team", label: "Team & roles", group: "Navigate", hint: "Go", keywords: "members roles", run: () => router.push("/dashboard/team") },
      );
    }
    list.push(
      { id: "act:copilot", label: "Ask the Copilot", group: "Actions", hint: "Action", keywords: "chat ai question", run: () => router.push("/dashboard/copilot") },
      { id: "act:tour", label: "Start the tutorial", group: "Actions", hint: "Action", keywords: "tour guide help walkthrough", run: () => start() },
      { id: "act:signout", label: "Sign out", group: "Actions", hint: "Action", keywords: "logout leave", run: () => void signOutAction() },
    );
    return list;
  }, [router, isAdmin, start, signOutAction]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo<Command[]>(() => {
    const leadHits: Command[] = q
      ? leads
          .filter((l) => l.name.toLowerCase().includes(q))
          .slice(0, 6)
          .map((l) => ({
            id: `lead:${l.id}`,
            label: l.name,
            group: "Leads",
            hint: "Lead",
            run: () => router.push(`/dashboard/pipeline/${l.id}`),
          }))
      : [];
    const cmdHits = commands.filter(
      (c) => !q || c.label.toLowerCase().includes(q) || (c.keywords ?? "").includes(q),
    );
    return [...leadHits, ...cmdHits];
  }, [q, leads, commands, router]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  // Keep the highlighted row in view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[active];
      if (cmd) {
        cmd.run();
        close();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  if (!open) return null;

  return (
    <OverlayPortal>
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="absolute inset-0 bg-[color-mix(in_srgb,var(--color-absolute-zero)_72%,transparent)] backdrop-blur-sm"
        onClick={close}
        aria-hidden
      />
      <div
        className="glass relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--color-border-strong)] shadow-2xl"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-ink-faint)]" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search leads, jump to a section, run an action…"
            aria-label="Command palette search"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            className="w-full bg-transparent py-3.5 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none"
          />
        </div>

        <div ref={listRef} id="command-palette-list" role="listbox" className="max-h-[52vh] overflow-y-auto py-1.5">
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-[var(--color-ink-faint)]">No matches for “{query}”.</p>
          )}
          {filtered.map((cmd, i) => {
            const isActive = i === active;
            const showHeader = i === 0 || filtered[i - 1].group !== cmd.group;
            return (
              <div key={cmd.id}>
                {showHeader && (
                  <p className="eyebrow px-4 pb-1 pt-2.5 text-[var(--color-ink-faint)]">{cmd.group}</p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  data-active={isActive}
                  onMouseMove={() => setActive(i)}
                  onClick={() => {
                    cmd.run();
                    close();
                  }}
                  className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition-colors ${
                    isActive
                      ? "bg-[color-mix(in_srgb,var(--color-frosted-canvas)_10%,transparent)] text-[var(--color-ink)]"
                      : "text-[var(--color-ink-muted)]"
                  }`}
                >
                  <span className="truncate">{cmd.label}</span>
                  {cmd.hint && (
                    <span className="ml-3 shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                      {cmd.hint}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-4 border-t border-[var(--color-border)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
          <span>↑↓ Move</span>
          <span>↵ Select</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
    </OverlayPortal>
  );
}
