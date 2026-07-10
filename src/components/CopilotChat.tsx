"use client";

import { useEffect, useRef, useState } from "react";
import { askCopilot } from "@/app/actions/copilot";

interface Msg {
  role: "user" | "assistant";
  text: string;
  tools?: { tool: string; ok: boolean }[];
}

const SUGGESTIONS = [
  "Summarise the pipeline",
  "Top hot leads to call this week",
  "Why is Alibaba scored that way?",
  "Where's our biggest untapped market?",
];

/** Render a subset of markdown: **bold**, and `- ` bullet lines. */
function Rich({ text }: { text: string }) {
  const lines = text.split("\n");
  const bold = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i} className="text-[var(--color-ink)]">{part.slice(2, -2)}</strong>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  return (
    <div className="space-y-1">
      {lines.map((ln, i) =>
        ln.startsWith("- ") ? (
          <div key={i} className="flex gap-2">
            <span className="text-[var(--color-brand)]">•</span>
            <span>{bold(ln.slice(2))}</span>
          </div>
        ) : ln.trim() === "" ? (
          <div key={i} className="h-1" />
        ) : (
          <p key={i}>{bold(ln)}</p>
        ),
      )}
    </div>
  );
}

export function CopilotChat({ foundryEnabled }: { foundryEnabled: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || pending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setPending(true);
    try {
      const res = await askCopilot(q);
      setMessages((m) => [...m, { role: "assistant", text: res.reply, tools: res.tools }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "Something went wrong. Please try again." }]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="glass flex h-[calc(100vh-13rem)] flex-col overflow-hidden">
      {!foundryEnabled && (
        <div className="border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-amber)_8%,transparent)] px-5 py-2 text-xs text-[var(--color-ink-muted)]">
          <span className="font-mono uppercase tracking-[0.14em] text-[var(--color-amber)]">Local preview</span> — grounded answers from live tools. Connect Foundry for full conversational AI.
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-6">
        {messages.length === 0 && (
          <div className="mx-auto max-w-md pt-8 text-center">
            <div className="eyebrow mb-2">BD Copilot</div>
            <p className="text-sm text-[var(--color-ink-muted)]">
              Ask about leads, scores, the pipeline, whitespace or reminders. I answer from live data and can draft
              outreach (an admin sends it).
            </p>
            <div className="mt-5 flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-[var(--color-border-strong)] px-4 py-2 text-sm text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-frosted-canvas)] hover:text-[var(--color-ink)]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[80%] rounded-2xl rounded-br-sm bg-[color-mix(in_srgb,var(--color-brand)_18%,transparent)] px-4 py-2.5 text-sm text-[var(--color-ink)]"
                  : "max-w-[85%] rounded-2xl rounded-bl-sm border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-frosted-canvas)_3%,transparent)] px-4 py-3 text-sm text-[var(--color-ink-muted)]"
              }
            >
              {m.role === "assistant" ? <Rich text={m.text} /> : m.text}
              {m.tools && m.tools.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.tools.map((t, j) => (
                    <span
                      key={j}
                      className="rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-faint)]"
                      title={t.ok ? "tool ran" : "tool error"}
                    >
                      {t.tool}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {pending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-[var(--color-border)] px-4 py-3 text-sm text-[var(--color-ink-faint)]">
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-ink-faint)] [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-ink-faint)] [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-ink-faint)]" />
              </span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-2 border-t border-[var(--color-border)] px-4 py-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the pipeline…"
          disabled={pending}
          className="h-10 flex-1 rounded-full border border-[var(--color-border-strong)] bg-transparent px-4 text-sm outline-none focus:border-[var(--color-brand)] disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="rounded-full bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03] disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
