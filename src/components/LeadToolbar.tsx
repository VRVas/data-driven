"use client";

import { useState } from "react";
import type { Brand } from "@/lib/types";
import { toJson, stampName } from "@/lib/export";
import { downloadFile, copyText, MIME } from "@/lib/download";
import { useToast } from "@/components/ui/Toast";

function leadSummaryMarkdown(b: Brand): string {
  const eur = (n: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
  const rows: (string | null)[] = [
    `# ${b.name}`,
    "",
    b.status ? `- **Status:** ${b.status}` : null,
    b.priority ? `- **Priority:** ${b.priority}` : null,
    b.industry ? `- **Industry:** ${b.industry}` : null,
    b.owner ? `- **Owner:** ${b.owner}` : null,
    b.poc ? `- **Point of contact:** ${b.poc}` : null,
    b.email ? `- **Email:** ${b.email}` : null,
    b.scores?.budget != null ? `- **Budget:** ${eur(b.scores.budget)}` : null,
    b.scores?.economicalEfficiency != null ? `- **Economical efficiency:** ${b.scores.economicalEfficiency}` : null,
    b.scores?.easeOfAccess != null ? `- **Ease of access:** ${b.scores.easeOfAccess}` : null,
    b.lastContact ? `- **Last contact:** ${b.lastContact}` : null,
    b.followUp ? `- **Follow up:** ${b.followUp}` : null,
    b.notes ? `\n**Notes:** ${b.notes}` : null,
  ];
  return rows.filter((r) => r !== null).join("\n");
}

export function LeadToolbar({ brand }: { brand: Brand }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();

  const copySummary = async () => {
    const ok = await copyText(leadSummaryMarkdown(brand));
    toast(ok ? "Summary copied" : "Copy failed", ok ? "success" : "error");
    setOpen(false);
  };
  const copyEmail = async () => {
    if (!brand.email) return;
    const ok = await copyText(brand.email);
    toast(ok ? "Email copied" : "Copy failed", ok ? "success" : "error");
    setOpen(false);
  };
  const exportJson = () => {
    downloadFile(`${stampName(brand.id)}.json`, toJson(brand), MIME.json);
    toast("Exported lead JSON");
    setOpen(false);
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Lead actions"
        className="grid h-9 w-9 place-items-center rounded-full border border-[var(--color-border-strong)] text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-frosted-canvas)] hover:text-[var(--color-ink)]"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div role="menu" className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] py-1 shadow-2xl">
            <Item onClick={copySummary}>Copy summary</Item>
            {brand.email && <Item onClick={copyEmail}>Copy contact email</Item>}
            <Item onClick={exportJson}>Export as JSON</Item>
          </div>
        </>
      )}
    </div>
  );
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
