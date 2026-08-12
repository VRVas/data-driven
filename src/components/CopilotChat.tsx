"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { runCopilotAction } from "@/app/actions/copilot";
import { listConversations, loadConversation } from "@/app/actions/conversations";
import { BlockRenderer } from "@/components/copilot/BlockRenderer";
import { relativeTime } from "@/lib/time";
import { blocksToMarkdown, blocksToSpeech, conversationToMarkdown } from "@/lib/copilot/serialize";
import { copyText, downloadFile, MIME } from "@/lib/download";
import { toJson, stampName } from "@/lib/export";
import { useToast } from "@/components/ui/Toast";
import type { Block, ActionSpec } from "@/lib/copilot/blocks";
import type { ConversationHeader } from "@/lib/copilot/threads";

interface Msg {
  role: "user" | "assistant";
  text?: string;
  blocks?: Block[];
  tools?: { tool: string; ok: boolean }[];
}

const SUGGESTIONS = [
  "What should I do today?",
  "Summarise the pipeline",
  "What's at risk of going cold?",
  "Why is Alibaba scored that way?",
  "What am I allowed to do?",
  "Move Alibaba to the next stage",
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

export function CopilotChat({ foundryEnabled, voiceEnabled = false, docsEnabled = false }: { foundryEnabled: boolean; voiceEnabled?: boolean; docsEnabled?: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [deep, setDeep] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [history, setHistory] = useState<ConversationHeader[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [lastUser, setLastUser] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const toast = useToast();
  const router = useRouter();
  const endRef = useRef<HTMLDivElement>(null);
  const [recording, setRecording] = useState(false);
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [docs, setDocs] = useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  async function runStream(q: string) {
    setPending(true);
    const controller = new AbortController();
    abortRef.current = controller;

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
        signal: controller.signal,
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
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        patchLast((msg) => ({ ...msg, blocks: [...(msg.blocks ?? []), { type: "callout", tone: "danger", title: null, text: "Something went wrong. Please try again." }] }));
      }
    } finally {
      abortRef.current = null;
      setPending(false);
    }
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || pending) return;
    setInput("");
    setLastUser(q);
    setMessages((m) => [...m, { role: "user", text: q }, { role: "assistant", blocks: [] }]);
    await runStream(q);
  }

  async function regenerate() {
    if (!lastUser || pending) return;
    setMessages((m) => {
      const copy = [...m];
      while (copy.length && copy[copy.length - 1].role === "assistant") copy.pop();
      copy.push({ role: "assistant", blocks: [] });
      return copy;
    });
    await runStream(lastUser);
  }

  function stop() {
    abortRef.current?.abort();
  }

  // Voice input: record from the mic, transcribe, then send as a normal message.
  async function toggleRecord() {
    if (recording) {
      mediaRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        if (blob.size === 0) return;
        try {
          const res = await fetch("/api/voice/transcribe", {
            method: "POST",
            headers: { "content-type": blob.type },
            body: blob,
          });
          const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
          if (res.ok && data.text) send(data.text);
          else toast(data.text === "" ? "No speech detected" : "Couldn't transcribe", "error");
        } catch {
          toast("Transcription failed", "error");
        }
      };
      mediaRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      toast("Microphone unavailable", "error");
    }
  }

  // Voice output: read an answer aloud with the configured voice (Luca).
  async function speak(msg: Msg, key: string) {
    if (speakingKey === key) {
      audioRef.current?.pause();
      setSpeakingKey(null);
      return;
    }
    audioRef.current?.pause();
    const text = msg.role === "user" ? msg.text ?? "" : blocksToSpeech(msg.blocks ?? []);
    if (!text) return;
    try {
      const res = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        toast("Couldn't play audio", "error");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audioRef.current = audio;
      setSpeakingKey(key);
      const cleanup = () => {
        setSpeakingKey((k) => (k === key ? null : k));
        URL.revokeObjectURL(url);
      };
      audio.onended = cleanup;
      audio.onerror = cleanup;
      await audio.play();
    } catch {
      toast("Audio playback failed", "error");
      setSpeakingKey(null);
    }
  }

  // Documents: load the user's uploaded files; upload/remove.
  useEffect(() => {
    if (!docsEnabled) return;
    fetch("/api/copilot/documents")
      .then((r) => r.json())
      .then((d) => setDocs(d.files ?? []))
      .catch(() => {});
  }, [docsEnabled]);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/copilot/documents", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.file) {
        setDocs((d) => [...d.filter((x) => x.id !== data.file.id), data.file]);
        toast(`Added ${data.file.name}`, "success");
      } else {
        toast(data.error ?? "Upload failed", "error");
      }
    } catch {
      toast("Upload failed", "error");
    } finally {
      setUploading(false);
    }
  }

  async function removeDoc(id: string) {
    setDocs((d) => d.filter((x) => x.id !== id));
    await fetch(`/api/copilot/documents?fileId=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  }

  const copyMessage = async (msg: Msg) => {
    const text = msg.role === "user" ? msg.text ?? "" : blocksToMarkdown(msg.blocks ?? []);
    const ok = await copyText(text);
    toast(ok ? "Copied" : "Copy failed", ok ? "success" : "error");
  };

  function exportConversation(fmt: "md" | "json") {
    const serial = messages.map((m) => ({ role: m.role, text: m.text ?? null, blocks: m.blocks ?? null }));
    if (fmt === "md") downloadFile(`${stampName("copilot")}.md`, conversationToMarkdown(serial), MIME.md);
    else downloadFile(`${stampName("copilot")}.json`, toJson(serial), MIME.json);
    toast("Conversation exported");
    setShowExport(false);
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
    // dvh (not vh) so a mobile browser's collapsing URL bar can't push the composer off-screen.
    <div className="glass flex h-[calc(100dvh-15rem)] min-h-[24rem] flex-col overflow-hidden sm:h-[calc(100dvh-13rem)]">
      <div className="relative flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <button
          onClick={newChat}
          className="rounded-full border border-[var(--color-border-strong)] px-3 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-frosted-canvas)] hover:text-[var(--color-ink)]"
        >
          + New chat
        </button>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowExport((v) => !v)}
                className="rounded-full border border-[var(--color-border-strong)] px-3 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-frosted-canvas)] hover:text-[var(--color-ink)]"
              >
                Export ▾
              </button>
              {showExport && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowExport(false)} aria-hidden />
                  <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] py-1 shadow-2xl">
                    <button onClick={() => exportConversation("md")} className="block w-full px-4 py-2 text-left text-sm text-[var(--color-ink-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-frosted-canvas)_5%,transparent)] hover:text-[var(--color-ink)]">Markdown</button>
                    <button onClick={() => exportConversation("json")} className="block w-full px-4 py-2 text-left text-sm text-[var(--color-ink-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-frosted-canvas)_5%,transparent)] hover:text-[var(--color-ink)]">JSON</button>
                  </div>
                </>
              )}
            </div>
          )}
          <button
            onClick={() => {
              setShowHistory((v) => !v);
              refreshHistory();
            }}
            className="rounded-full border border-[var(--color-border-strong)] px-3 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-frosted-canvas)] hover:text-[var(--color-ink)]"
          >
            History ▾
          </button>
        </div>
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
              cards — and I can draft outreach (an admin sends it) or move a lead to a new pipeline stage, if your role and
              the workflow allow it.
            </p>
            <div data-tour="copilot-suggestions" className="mt-5 flex flex-col gap-2">
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
          <div key={i} className={`group flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "user" ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyMessage(msg)}
                  aria-label="Copy message"
                  className="text-[var(--color-ink-faint)] opacity-0 transition-opacity hover:text-[var(--color-ink)] group-hover:opacity-100"
                >
                  ⧉
                </button>
                <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-[color-mix(in_srgb,var(--color-brand)_18%,transparent)] px-4 py-2.5 text-sm text-[var(--color-ink)]">
                  {msg.text}
                </div>
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
                <div className="mt-2 flex items-center gap-3 border-t border-[var(--color-border)] pt-2">
                  <button onClick={() => copyMessage(msg)} className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]">
                    Copy
                  </button>
                  {voiceEnabled && (
                    <button onClick={() => speak(msg, `speak-${i}`)} className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]">
                      {speakingKey === `speak-${i}` ? "Stop" : "Listen"}
                    </button>
                  )}
                  {i === messages.length - 1 && !pending && (
                    <button onClick={regenerate} className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]">
                      Regenerate
                    </button>
                  )}
                </div>
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

      {docsEnabled && docs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--color-border)] px-4 pt-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">Docs</span>
          {docs.map((d) => (
            <span key={d.id} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-strong)] py-0.5 pl-2.5 pr-1 text-xs text-[var(--color-ink-muted)]">
              {d.name}
              <button onClick={() => removeDoc(d.id)} aria-label={`Remove ${d.name}`} className="grid h-4 w-4 place-items-center rounded-full text-[var(--color-ink-faint)] hover:text-[var(--color-rose)]">×</button>
            </span>
          ))}
          {uploading && <span className="text-xs text-[var(--color-ink-faint)]">uploading…</span>}
        </div>
      )}

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
          data-tour="copilot-reasoning"
          className={
            "shrink-0 rounded-full border px-3 py-2 text-xs font-medium transition-colors " +
            (deep
              ? "border-[var(--color-brand)] bg-[color-mix(in_srgb,var(--color-brand)_16%,transparent)] text-[var(--color-ink)]"
              : "border-[var(--color-border-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]")
          }
        >
          ✦<span className="hidden sm:inline"> Think deeply</span>
        </button>
        {voiceEnabled && (
          <button
            type="button"
            onClick={toggleRecord}
            title={recording ? "Stop recording" : "Speak your question"}
            aria-pressed={recording}
            aria-label={recording ? "Stop recording" : "Record voice"}
            data-tour="copilot-mic"
            className={
              "shrink-0 rounded-full border p-2 transition-colors " +
              (recording
                ? "border-[var(--color-rose)] bg-[color-mix(in_srgb,var(--color-rose)_16%,transparent)] text-[var(--color-rose)] animate-pulse"
                : "border-[var(--color-border-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]")
            }
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />
            </svg>
          </button>
        )}
        {docsEnabled && (
          <>
            <input
              ref={fileRef}
              type="file"
              onChange={onPickFile}
              accept=".pdf,.doc,.docx,.txt,.md,.markdown,.csv,.json,.ppt,.pptx,.html,.htm,.rtf"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              title="Attach a document"
              aria-label="Attach a document"
              data-tour="copilot-attach"
              className="shrink-0 rounded-full border border-[var(--color-border-strong)] p-2 text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
          </>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the pipeline…"
          disabled={pending}
          data-tour="copilot-input"
          className="h-10 min-w-0 flex-1 rounded-full border border-[var(--color-border-strong)] bg-transparent px-4 text-sm outline-none focus:border-[var(--color-brand)] disabled:opacity-60"
        />
        {pending ? (
          <button
            type="button"
            onClick={stop}
            className="shrink-0 rounded-full border border-[color-mix(in_srgb,var(--color-rose)_50%,transparent)] px-4 py-2.5 text-sm font-medium text-[var(--color-rose)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-rose)_12%,transparent)] sm:px-5"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="shrink-0 rounded-full bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03] disabled:opacity-50 sm:px-5"
          >
            Ask
          </button>
        )}
      </form>
    </div>
  );
}
