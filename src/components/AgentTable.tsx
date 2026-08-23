"use client";

import { useMemo, useState } from "react";
import type { Agent } from "@/lib/types";
import { Badge } from "@/components/Badge";
import { AgentEditor } from "@/components/AgentEditor";
import { STATUS_TOKEN, PRIORITY_TOKEN } from "@/lib/scoring";
import type { BrandStatus, Priority } from "@/lib/types";
import { ExportMenu } from "@/components/ExportMenu";
import type { Column } from "@/lib/export";

const AGENT_COLS: Column[] = [
  { key: "name", label: "Agent / Agency" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "owner", label: "Owner" },
  { key: "poc", label: "POC" },
  { key: "initialContact", label: "Initial contact" },
  { key: "lastContact", label: "Last contact" },
  { key: "followUp", label: "Follow up" },
  { key: "notes", label: "Notes" },
];
const agentRows = (list: Agent[]): Record<string, unknown>[] =>
  list.map((a) => ({
    name: a.name,
    status: a.status,
    priority: a.priority,
    owner: a.owner,
    poc: a.poc,
    initialContact: a.initialContact,
    lastContact: a.lastContact,
    followUp: a.followUp,
    notes: a.notes,
  }));

export function AgentTable({ agents }: { agents: Agent[] }) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Agent | null | undefined>(undefined);

  const rows = useMemo(() => {
    const query = q.toLowerCase();
    return agents.filter((a) =>
      `${a.name} ${a.poc ?? ""} ${a.owner ?? ""} ${a.notes ?? ""}`.toLowerCase().includes(query),
    );
  }, [agents, q]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search agent, POC, owner…"
          className="h-9 w-64 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm outline-none focus:border-[var(--color-brand)]"
        />
        <button
          onClick={() => setEditing(null)}
          className="ml-auto rounded-full bg-[var(--color-brand)] px-4 py-1.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03]"
        >
          + New agent
        </button>
        <ExportMenu filename="agents" columns={AGENT_COLS} rows={agentRows(rows)} allRows={agentRows(agents)} size="sm" />
        <span className="text-sm text-[var(--color-ink-muted)]">{rows.length} of {agents.length}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-surface)]">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">Agent / Agency</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">Status</th>
              <th className="hidden px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)] sm:table-cell">Priority</th>
              <th className="hidden px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)] lg:table-cell">Owner</th>
              <th className="hidden px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)] md:table-cell">POC</th>
              <th className="hidden px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)] xl:table-cell">Last contact</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-t border-[var(--color-border)] transition-colors hover:bg-[var(--color-surface)]/60">
                <td className="px-3 py-2 font-medium">{a.name}</td>
                <td className="px-3 py-2">
                  {a.status && <Badge color={STATUS_TOKEN[a.status as BrandStatus] ?? "var(--color-ink-faint)"}>{a.status}</Badge>}
                </td>
                <td className="hidden px-3 py-2 sm:table-cell">
                  {a.priority && <Badge color={PRIORITY_TOKEN[a.priority as Priority]}>{a.priority.replace(" Lead", "")}</Badge>}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-[var(--color-ink-muted)] lg:table-cell">{a.owner ?? "-"}</td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-[var(--color-ink-muted)] md:table-cell">{a.poc ?? "-"}</td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-[var(--color-ink-muted)] xl:table-cell">{a.lastContact ?? "-"}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => setEditing(a)}
                    className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-ink)]"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing !== undefined && (
        <AgentEditor agent={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  );
}
