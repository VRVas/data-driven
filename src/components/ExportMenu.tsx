"use client";

import { useState } from "react";
import { toCsv, toJson, toXlsx, toPdf, stampName, type Column } from "@/lib/export";
import { downloadFile, downloadBlob, copyText, MIME } from "@/lib/download";
import { useToast } from "@/components/ui/Toast";

interface Props {
  filename: string;
  columns: Column[];
  /** The current (e.g. filtered) rows. */
  rows: Record<string, unknown>[];
  /** Optional full dataset — when it differs from `rows`, an "all" option appears. */
  allRows?: Record<string, unknown>[];
  label?: string;
  size?: "sm" | "md";
}

export function ExportMenu({ filename, columns, rows, allRows, label = "Export", size = "md" }: Props) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const hasAll = !!allRows && allRows.length !== rows.length;

  const save = (fmt: "csv" | "json" | "xlsx" | "pdf", data: Record<string, unknown>[]) => {
    const base = stampName(filename);
    if (fmt === "csv") downloadFile(`${base}.csv`, toCsv(columns, data), MIME.csv);
    else if (fmt === "json") downloadFile(`${base}.json`, toJson(data), MIME.json);
    else if (fmt === "xlsx") downloadBlob(`${base}.xlsx`, toXlsx(columns, data), MIME.xlsx);
    else downloadBlob(`${base}.pdf`, toPdf(titleFromFilename(filename), columns, data), MIME.pdf);
    toast(`Exported ${data.length} ${data.length === 1 ? "row" : "rows"}`);
    setOpen(false);
  };
  const copy = async () => {
    const ok = await copyText(toCsv(columns, rows));
    toast(ok ? "Copied to clipboard" : "Copy failed", ok ? "success" : "error");
    setOpen(false);
  };

  const btn =
    size === "sm"
      ? "rounded-full border border-[var(--color-border-strong)] px-2.5 py-1 text-xs"
      : "rounded-full border border-[var(--color-border-strong)] px-3.5 py-1.5 text-sm";

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${btn} text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-frosted-canvas)] hover:text-[var(--color-ink)]`}
      >
        {label} ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] py-1 shadow-2xl"
          >
            <Item onClick={() => save("csv", rows)}>Download CSV{hasAll ? ` · ${rows.length} shown` : ""}</Item>
            <Item onClick={() => save("json", rows)}>Download JSON</Item>
            <Item onClick={() => save("xlsx", rows)}>Download Excel (.xlsx)</Item>
            <Item onClick={() => save("pdf", rows)}>Download PDF</Item>
            {hasAll && (
              <Item onClick={() => save("csv", allRows!)}>
                Download all {allRows!.length} · CSV
              </Item>
            )}
            <div className="my-1 h-px bg-[var(--color-border)]" />
            <Item onClick={copy}>Copy as CSV</Item>
          </div>
        </>
      )}
    </div>
  );
}

/** "pipeline" -> "Pipeline", "data-quality" -> "Data Quality" (PDF document title). */
function titleFromFilename(name: string): string {
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function Item({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="block w-full px-4 py-2 text-left text-sm text-[var(--color-ink-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-frosted-canvas)_5%,transparent)] hover:text-[var(--color-ink)]"
    >
      {children}
    </button>
  );
}
