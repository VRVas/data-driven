import type { Block } from "./blocks";
import { toCsv } from "@/lib/export";

const eur = (n: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

function fmtCell(v: string | number | null, kind?: string | null): string {
  if (v == null) return "—";
  if (kind === "currency" && typeof v === "number") return eur(v);
  if (kind === "percent" && typeof v === "number") return `${Math.round(v)}%`;
  return String(v);
}

/** Serialize a single table block to CSV (used by the per-block "Copy CSV"). */
export function tableBlockToCsv(block: Extract<Block, { type: "table" }>): string {
  return toCsv(
    block.columns.map((c) => ({ key: c.key, label: c.label })),
    block.rows,
  );
}

function blockToMarkdown(block: Block): string {
  switch (block.type) {
    case "heading":
      return `### ${block.title}${block.subtitle ? `\n_${block.subtitle}_` : ""}`;
    case "text":
      return block.text;
    case "reasoning":
      return `> _Reasoning:_ ${block.text.replace(/\n/g, " ")}`;
    case "callout":
      return `> ${block.title ? `**${block.title}** ` : ""}${block.text}`;
    case "divider":
      return "---";
    case "metrics":
      return block.items.map((it) => `- **${it.label}:** ${it.value}${it.unit ? ` ${it.unit}` : ""}`).join("\n");
    case "keyValue":
      return block.items.map((it) => `- **${it.label}:** ${it.value}`).join("\n");
    case "list":
      return block.items.map((it, i) => `${block.style === "ordered" ? `${i + 1}.` : block.style === "check" ? "- [ ]" : "-"} ${it}`).join("\n");
    case "badges":
      return block.items.map((it) => `\`${it.label}\``).join(" ");
    case "table": {
      const head = `| ${block.columns.map((c) => c.label).join(" | ")} |`;
      const sep = `| ${block.columns.map(() => "---").join(" | ")} |`;
      const body = block.rows.map((r) => `| ${block.columns.map((c) => fmtCell(r[c.key] ?? null, c.kind)).join(" | ")} |`).join("\n");
      return [block.caption ? `**${block.caption}**` : "", head, sep, body].filter(Boolean).join("\n");
    }
    case "chart":
      return `**${block.title ?? "Chart"}**\n${(block.series ?? []).map((s) => `- ${s.label}: ${s.value}`).join("\n")}`;
    case "leadCard":
      return `- **${block.name}** — ${[block.status, block.score != null ? `score ${block.score}` : null, block.budgetEur != null ? eur(block.budgetEur) : null].filter(Boolean).join(", ")}`;
    case "leadGrid":
      return block.leads
        .map((l) => `- **${l.name}** — ${[l.status, l.score != null ? `score ${l.score}` : null].filter(Boolean).join(", ")}`)
        .join("\n");
    case "companyCard":
      return `- **${block.name}** — ${[
        block.industry,
        block.openDealCount != null ? `${block.openDealCount} open` : null,
        block.lifetimeValueEur != null ? `lifetime ${eur(block.lifetimeValueEur)}` : null,
        block.repeatValueEur ? `repeat ${eur(block.repeatValueEur)}` : null,
      ]
        .filter(Boolean)
        .join(", ")}`;
    case "scoreBreakdown":
      return [
        `**${block.name} — priority ${block.priority}${block.grade ? ` (${block.grade})` : ""}**`,
        `- Opportunity: ${Math.round(block.opportunity)}`,
        `- Winnability: ${Math.round(block.winnability)}`,
        `- √(${Math.round(block.opportunity)} × ${Math.round(block.winnability)}) = ${block.priority}`,
        block.ease != null ? `- Ease: ${Math.round(block.ease)} (reported, never blended in)` : null,
        ...(block.drivers ?? []).map((d) => `- ${d.label}: ${d.detail}`),
      ]
        .filter(Boolean)
        .join("\n");
    case "comparison":
      return block.items
        .map((it) => `**${it.title}**\n${it.metrics.map((m) => `- ${m.label}: ${m.value}`).join("\n")}`)
        .join("\n\n");
    case "recommendation":
      return `> **★ ${block.title}** — ${block.rationale}${block.confidence != null ? ` _(${Math.round(block.confidence * 100)}% confidence)_` : ""}`;
    case "timeline":
      return block.events.map((e) => `- ${e.date ? `\`${e.date}\` ` : ""}${e.label}`).join("\n");
    case "actions":
      return `_Actions: ${block.actions.map((a) => a.label).join(", ")}_`;
    case "sources":
      return [
        block.title ? `**${block.title}**` : "**Sources**",
        ...block.items.map((s) => `${s.n != null ? `${s.n}. ` : "- "}[${s.title}](${s.url})`),
      ].join("\n");
    default:
      return "";
  }
}

/** Serialize a composed answer to clean Markdown (for copy / export). */
export function blocksToMarkdown(blocks: Block[]): string {
  return blocks.map(blockToMarkdown).filter(Boolean).join("\n\n");
}

/** Plain, speakable prose from blocks (for text-to-speech). Skips visual-only
 *  blocks (charts/tables/dividers) and drops markdown punctuation. */
export function blocksToSpeech(blocks: Block[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        parts.push(block.subtitle ? `${block.title}. ${block.subtitle}` : block.title);
        break;
      case "text":
        parts.push(block.text);
        break;
      case "callout":
        parts.push(block.title ? `${block.title}. ${block.text}` : block.text);
        break;
      case "reasoning":
        parts.push(block.text);
        break;
      case "list":
        parts.push(block.items.join(". "));
        break;
      case "metrics":
        parts.push(block.items.map((it) => `${it.label}: ${it.value}${it.unit ? ` ${it.unit}` : ""}`).join(". "));
        break;
      case "keyValue":
        parts.push(block.items.map((it) => `${it.label}: ${it.value}`).join(". "));
        break;
      case "leadCard":
        parts.push(`${block.name}${block.status ? `, ${block.status}` : ""}`);
        break;
      case "leadGrid":
        parts.push(block.leads.map((l) => l.name).join(", "));
        break;
      case "companyCard":
        parts.push(`${block.name}${block.openDealCount != null ? `, ${block.openDealCount} open deals` : ""}`);
        break;
      case "scoreBreakdown":
        parts.push(
          `${block.name} scores ${block.priority}, from opportunity ${Math.round(block.opportunity)} and winnability ${Math.round(block.winnability)}.`,
        );
        break;
      case "recommendation":
        parts.push(`Recommendation: ${block.title}. ${block.rationale}`);
        break;
      default:
        break; // chart, table, badges, comparison, timeline, actions, divider
    }
  }
  return parts
    .join(". ")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\.\s*\.+/g, ".")
    .trim();
}

export interface SerializableMessage {
  role: "user" | "assistant";
  text?: string | null;
  blocks?: Block[] | null;
}

/** Serialize a whole conversation to Markdown. */
export function conversationToMarkdown(messages: SerializableMessage[], title = "Copilot conversation"): string {
  const parts = messages.map((m) =>
    m.role === "user" ? `**You:** ${m.text ?? ""}` : blocksToMarkdown(m.blocks ?? []),
  );
  return `# ${title}\n\n${parts.join("\n\n---\n\n")}\n`;
}
