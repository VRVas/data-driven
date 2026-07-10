"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { runCopilotAction } from "@/app/actions/copilot";
import { listConversations, loadConversation } from "@/app/actions/conversations";
import { BlockRenderer } from "@/components/copilot/BlockRenderer";
import { relativeTime } from "@/lib/time";
import type { Block, ActionSpec } from "@/lib/copilot/blocks";
import type { ConversationHeader } from "@/lib/copilot/threads";

interface Msg {
  role: "user" | "assistant";
  text?: string;
  blocks?: Block[];
  tools?: { tool: string; ok: boolean }[];
}

const SUGGESTIONS = [
  "Summarise the pipeline",
  "Top hot leads to call this week",
  "Why is Alibaba scored that way?",
  "Where's our biggest untapped market?",
];

/** Parse one SSE record ("event: x\ndata: {...}"). */
function parseSSE(chunk: string): { event: string; data: unknown } | null {
  let event = "message";
  let data = "";
  for (const line of chunk.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return { event, data: null };
  }
}

export function CopilotChat({ foundryEnabled }: { foundryEnabled: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [deep, setDeep] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [history, setHistory] = useState<ConversationHeader[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const router = useRouter();
  const endRef = useRef<HTMLDivElement>(null);

  const refreshHistory = () => listConversations().then(setHistory).catch(() => {});
  useEffect(() => {
    refreshHistory();
  }, []);

  function newChat() {
    setMessages([]);
    setConversationId(null);
    setShowHistory(false);
  }

  async function resume(id: string) {
    setShowHistory(false);
    const conv = await loadConversation(id);
    if (!conv) return;
    setConversationId(conv.id);
    setMessages(
      conv.messages.map((mm) =>
        mm.role === "user"
          ? { role: "user", text: mm.text ?? "" }
          : { role: "assistant", blocks: (mm.blocks ?? []) as Block[] },
      ),
    );
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || pending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }, { role: "assistant", blocks: [] }]);
    setPending(true);

    const patchLast = (fn: (msg: Msg) => Msg) =>
      setMessages((m) => {
        const copy = [...m];
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i].role === "assistant") {
            copy[i] = fn(copy[i]);
            break;
          }
        }
        return copy;
      });

    try {
      const res = await fetch("/api/copilot/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: q, reasoning: deep, conversationId }),
      });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const ev = parseSSE(part);
          if (!ev) continue;
          if (ev.event === "block" && ev.data) {
            patchLast((msg) => ({ ...msg, blocks: [...(msg.blocks ?? []), ev.data as Block] }));
          } else if (ev.event === "tools") {
            patchLast((msg) => ({ ...msg, tools: ev.data as Msg["tools"] }));
          } else if (ev.event === "error") {
            const em = String((ev.data as { message?: string })?.message ?? "Error");
            patchLast((msg) => ({ ...msg, blocks: [...(msg.blocks ?? []), { type: "callout", tone: "danger", title: null, text: em }] }));
          } else if (ev.event === "done") {
            const cid = (ev.data as { conversationId?: string })?.conversationId;
            if (cid) setConversationId(cid);
            refreshHistory();
          }
        }
      }
    } catch {
      patchLast((msg) => ({ ...msg, blocks: [{ type: "callout", tone: "danger", title: null, text: "Something went wrong. Please try again." }] }));
    } finally {
      setPending(false);
    }
  }

  async function onAction(a: ActionSpec) {
    const args = (a.args ?? {}) as Record<string, unknown>;
    // Client-side navigation pseudo-tools.
    if (a.tool === "open_lead" && args.id) return router.push(`/dashboard/pipeline/${args.id}`);
    if (a.tool === "open_outbox") return router.push("/dashboard/outbox");
    if (a.tool === "ask" && args.message) return send(String(args.message));

    // Real, role-gated tools.
    const key = `${a.tool}:${JSON.stringify(a.args ?? {})}`;
    setPendingAction(key);
    try {
      const res = await runCopilotAction(a.tool, args);
      setMessages((m) => [...m, { role: "assistant", blocks: res.blocks }]);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="glass flex h-[calc(100vh-13rem)] flex-col overflow-hidden">
      <div className="relative flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <button
          onClick={newChat}
          className="rounded-full border border-[var(--color-border-strong)] px-3 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-frosted-canvas)] hover:text-[var(--color-ink)]"
        >
          + New chat
        </button>
        <button
          onClick={() => {
            setShowHistory((v) => !v);
            refreshHistory();
          }}
          className="rounded-full border border-[var(--color-border-strong)] px-3 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-frosted-canvas)] hover:text-[var(--color-ink)]"
        >
          History ▾
        </button>
        {showHistory && (
          <div className="absolute right-4 top-11 z-20 w-72 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-2xl">
            {history.length === 0 ? (
              <div className="px-4 py-3 text-xs text-[var(--color-ink-faint)]">No past conversations yet.</div>
            ) : (
              <ul className="max-h-72 overflow-y-auto py-1">
                {history.map((h) => (
                  <li key={h.id}>
                    <button
                      onClick={() => resume(h.id)}
                      className="block w-full px-4 py-2 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--color-frosted-canvas)_5%,transparent)]"
                    >
                      <div className="truncate text-sm text-[var(--color-ink)]">{h.title}</div>
                      <div className="text-[10px] text-[var(--color-ink-faint)]">
                        {relativeTime(h.updatedAt)} · {h.messageCount} msgs
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {!foundryEnabled && (
        <div className="border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-amber)_8%,transparent)] px-5 py-2 text-xs text-[var(--color-ink-muted)]">
          <span className="font-mono uppercase tracking-[0.14em] text-[var(--color-amber)]">Local preview</span> — grounded, composed cards from live tools. Connect Foundry for full conversational AI.
        </div>
      )}

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-6">
        {messages.length === 0 && (
          <div className="mx-auto max-w-md pt-6 text-center">
            <div className="eyebrow mb-2">BD Copilot</div>
            <p className="text-sm text-[var(--color-ink-muted)]">
              Ask about leads, scores, the pipeline, whitespace or reminders. Answers come back as live charts, tables and
              cards — and I can draft outreach (an admin sends it).
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

        {messages.map((msg, i) => (
          <div key={i} className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}>
            {msg.role === "user" ? (
              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-[color-mix(in_srgb,var(--color-brand)_18%,transparent)] px-4 py-2.5 text-sm text-[var(--color-ink)]">
                {msg.text}
              </div>
            ) : msg.blocks && msg.blocks.length > 0 ? (
              <div className="w-full max-w-[92%] rounded-2xl rounded-bl-sm border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-frosted-canvas)_3%,transparent)] px-4 py-4">
                <BlockRenderer blocks={msg.blocks} onAction={onAction} pendingAction={pendingAction} />
                {msg.tools && msg.tools.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1 border-t border-[var(--color-border)] pt-2">
                    {msg.tools.map((t, j) => (
                      <span key={j} className="rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-faint)]">
                        {t.tool}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
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
        <button
          type="button"
          onClick={() => setDeep((v) => !v)}
          title="Think deeply — route to the reasoning model"
          aria-pressed={deep}
          className={
            "shrink-0 rounded-full border px-3 py-2 text-xs font-medium transition-colors " +
            (deep
              ? "border-[var(--color-brand)] bg-[color-mix(in_srgb,var(--color-brand)_16%,transparent)] text-[var(--color-ink)]"
              : "border-[var(--color-border-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]")
          }
        >
          ✦ Think deeply
        </button>
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
