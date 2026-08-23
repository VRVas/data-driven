import type { ValueBasis } from "@/lib/crm/logic";

const LABEL: Record<ValueBasis, string> = {
  accepted: "accepted",
  quoted: "quoted",
  estimate: "estimate",
  none: "no value",
};

const EXPLAIN: Record<ValueBasis, string> = {
  accepted: "From the accepted proposal - the client agreed to this figure.",
  quoted: "From the proposal currently with the client, awaiting a decision.",
  estimate: "The figure typed when the lead opened. No proposal has been sent yet.",
  none: "Nobody has put a figure on this deal.",
};

const TONE: Record<ValueBasis, string> = {
  accepted: "var(--color-mint)",
  quoted: "var(--color-amber)",
  estimate: "var(--color-ink-faint)",
  none: "var(--color-ink-faint)",
};

/** Says which of the three possible figures a total is quoting, so two pages never disagree silently. */
export function ValueBasisNote({ basis }: { basis: ValueBasis }) {
  return (
    <span
      title={EXPLAIN[basis]}
      className="ml-1.5 cursor-help font-mono text-[10px] uppercase tracking-[0.08em]"
      style={{ color: TONE[basis] }}
    >
      {LABEL[basis]}
    </span>
  );
}
