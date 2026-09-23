import { marked, type Token } from "marked";
import type { Block } from "../blocks";
import type { Artifact, ExternalResult, OutputFormat, PendingAction, RenderedMessage } from "./contracts";

interface Run { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string }

export function safeUrl(value: string, base?: string): string | undefined {
  try {
    const url = new URL(value, base);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function escapeMarkdownV2(text: string): string {
  return text.replace(/[\\_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

function tokensToRuns(tokens: Token[] = [], style: Omit<Run, "text"> = {}): Run[] {
  const runs: Run[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "space": runs.push({ text: "\n" }); break;
      case "heading": runs.push(...tokensToRuns(token.tokens, { ...style, bold: true }), { text: "\n\n" }); break;
      case "strong": runs.push(...tokensToRuns(token.tokens, { ...style, bold: true })); break;
      case "em": runs.push(...tokensToRuns(token.tokens, { ...style, italic: true })); break;
      case "link": runs.push(...tokensToRuns(token.tokens, { ...style, href: safeUrl(token.href) })); break;
      case "image": runs.push({ text: token.text || "Image", href: safeUrl(token.href) }); break;
      case "codespan": case "code": runs.push({ text: token.text, code: true }, ...(token.type === "code" ? [{ text: "\n\n" }] : [])); break;
      case "paragraph": runs.push(...tokensToRuns(token.tokens, style), { text: "\n\n" }); break;
      case "blockquote": runs.push(...tokensToRuns(token.tokens, style)); break;
      case "list":
        token.items.forEach((item: { tokens: Token[] }, index: number) => runs.push({ text: token.ordered ? `${index + 1}. ` : "- " }, ...tokensToRuns(item.tokens, style), { text: "\n" }));
        break;
      case "table":
        runs.push({ text: token.header.map((cell: { text: string }) => cell.text).join(" | "), bold: true }, { text: "\n" });
        for (const row of token.rows) runs.push({ text: row.map((cell: { text: string }) => cell.text).join(" | ") }, { text: "\n" });
        break;
      case "br": case "hr": runs.push({ text: "\n" }); break;
      case "text":
        if (token.tokens) runs.push(...tokensToRuns(token.tokens, style));
        else runs.push({ text: token.text, ...style });
        break;
      case "escape": runs.push({ text: token.text, ...style }); break;
      case "def": break;
      default: runs.push({ text: token.raw ?? "", ...style });
    }
  }
  return runs;
}

function encodedRun(run: Run, format: OutputFormat): string {
  const href = run.href && safeUrl(run.href);
  if (format === "plain-text" || format === "json") return run.text + (href ? ` (${href})` : "");
  if (format === "telegram-markdownv2") {
    if (run.code) return `\`${run.text.replace(/[\\`]/g, "\\$&")}\``;
    let text = escapeMarkdownV2(run.text);
    if (run.bold) text = `*${text}*`;
    else if (run.italic) text = `_${text}_`;
    if (href) text = `[${text}](${href.replace(/[\\)]/g, "\\$&")})`;
    return text;
  }
  if (run.code) return `\`${run.text.replace(/`/g, "'")}\``;
  let text = run.text.replace(/[\\`*_[\]<>#|]/g, "\\$&");
  if (run.bold) text = `**${text}**`;
  else if (run.italic) text = `_${text}_`;
  if (href) text = `[${text}](${href.replace(/[()]/g, (character) => encodeURIComponent(character))})`;
  return text;
}

export function renderRuns(runs: Run[], format: OutputFormat, limit = format === "telegram-markdownv2" ? 3500 : 12000): RenderedMessage[] {
  const messages: RenderedMessage[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) messages.push({ text: current, ...(format === "telegram-markdownv2" ? { parseMode: "MarkdownV2" as const } : {}) });
    current = "";
  };
  for (const original of runs) {
    if (!original.text) continue;
    const run = original.href && original.href.length > 1000 ? { ...original, text: `${original.text} (${original.href})`, href: undefined } : original;
    let fragment = "";
    for (const character of run.text) {
      const next = encodedRun({ ...run, text: fragment + character }, format);
      if (next.length + current.length > limit) {
        if (fragment) current += encodedRun({ ...run, text: fragment }, format);
        flush();
        fragment = character;
      } else fragment += character;
    }
    current += encodedRun({ ...run, text: fragment }, format);
  }
  flush();
  return messages;
}

function csv(rows: (string | number | null)[][]): string {
  return rows.map((row) => row.map((value) => {
    const text = String(value ?? "");
    const safe = typeof value === "string" && /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n");
}

export function renderAnswer(blocks: Block[], format: OutputFormat, baseUrl: string, actions: PendingAction[] = [], allowCsv = true): ExternalResult {
  const runs: Run[] = [];
  const artifacts: Artifact[] = [];
  const warnings: string[] = [];
  const visible = blocks.filter((block) => block.type !== "reasoning");
  const line = (text: string, bold = false, href?: string) => runs.push({ text, bold, href }, { text: "\n" });
  const prose = (text: string) => runs.push(...tokensToRuns(marked.lexer(text)));
  const field = (label: string, value: unknown) => {
    runs.push({ text: `${label}: `, bold: true }, { text: String(value ?? "-") }, { text: "\n" });
  };
  const lead = (entry: { id: string; name: string; status?: string | null; priority?: string | null; score?: number | null; budgetEur?: number | null; quadrant?: string | null }) => {
    line(entry.name, true, safeUrl(`/dashboard/pipeline/${encodeURIComponent(entry.id)}`, baseUrl));
    if (entry.status) field("Stage", entry.status);
    if (entry.priority) field("Priority label", entry.priority);
    if (entry.score != null) field("Score", entry.score);
    if (entry.budgetEur != null) field("Value EUR", entry.budgetEur);
    if (entry.quadrant) field("Quadrant", entry.quadrant);
  };
  for (const [index, block] of visible.entries()) {
    switch (block.type) {
      case "heading": line(block.title, true); if (block.subtitle) line(block.subtitle); break;
      case "text": prose(block.text); break;
      case "callout": if (block.title) line(block.title, true); prose(block.text); break;
      case "divider": line(""); break;
      case "metrics": for (const entry of block.items) field(entry.label, `${entry.value}${entry.unit ? ` ${entry.unit}` : ""}${entry.delta != null ? ` (change ${entry.delta})` : ""}`); break;
      case "keyValue": for (const entry of block.items) field(entry.label, entry.value); break;
      case "list": block.items.forEach((entry, itemIndex) => { line(`${block.style === "ordered" ? `${itemIndex + 1}.` : "-"} ${entry}`); }); break;
      case "badges": line(block.items.map((entry) => entry.label).join(", ")); break;
      case "table": {
        if (block.caption) line(block.caption, true);
        block.rows.slice(0, 12).forEach((row, rowIndex) => {
          line(`Row ${rowIndex + 1}`, true);
          for (const column of block.columns) field(column.label, row[column.key]);
        });
        artifacts.push(allowCsv
          ? { id: `table-${index}`, name: `table-${index}.csv`, mediaType: "text/csv", text: csv([block.columns.map((column) => column.label), ...block.rows.map((row) => block.columns.map((column) => row[column.key] ?? null))]) }
          : { id: `table-${index}`, name: `table-${index}.json`, mediaType: "application/json", text: JSON.stringify(block, null, 2) });
        if (block.rows.length > 12) { line(`${block.rows.length} rows total; the full table is attached as ${allowCsv ? "CSV" : "JSON"}.`); warnings.push("table_preview_truncated"); }
        break;
      }
      case "chart": {
        line(block.title ?? `${block.variant} chart`, true);
        line("Text representation of chart data.");
        for (const entry of (block.series ?? []).slice(0, 20)) field(entry.label, entry.value);
        for (const point of (block.points ?? []).slice(0, 20)) field(point.label ?? "Point", `${block.xLabel ?? "x"} ${point.x}; ${block.yLabel ?? "y"} ${point.y}${point.size != null ? `; size ${point.size}` : ""}`);
        artifacts.push({ id: `chart-${index}`, name: `chart-${index}.json`, mediaType: "application/json", text: JSON.stringify(block, null, 2) });
        warnings.push("chart_rendered_as_data");
        if ((block.series?.length ?? 0) > 20 || (block.points?.length ?? 0) > 20) { line("Additional chart data is included in the JSON artifact."); warnings.push("chart_preview_truncated"); }
        break;
      }
      case "leadCard": lead(block); break;
      case "leadGrid": for (const entry of block.leads) { lead(entry); line(""); } break;
      case "companyCard":
        line(block.name, true, safeUrl(`/dashboard/companies/${encodeURIComponent(block.id)}`, baseUrl));
        field("Industry", block.industry); field("Owner", block.owner); field("Open deals", block.openDealCount);
        field("Open pipeline EUR", block.openPipelineEur); field("Lifetime EUR", block.lifetimeValueEur); field("Repeat EUR", block.repeatValueEur);
        break;
      case "scoreBreakdown":
        line(block.name, true); field("Priority", block.priority); field("Grade", block.grade); field("Quadrant", block.quadrant);
        field("Opportunity", block.opportunity); field("Winnability", block.winnability);
        field("Expected value EUR", block.expectedValueEur);
        if (block.ease != null) field("Ease (excluded from priority)", block.ease);
        for (const driver of block.drivers ?? []) field(driver.label, driver.detail);
        break;
      case "comparison": for (const entry of block.items) { line(entry.title, true); if (entry.subtitle) line(entry.subtitle); for (const metric of entry.metrics) field(metric.label, metric.value); } break;
      case "recommendation": line(block.title, true); prose(block.rationale); if (block.confidence != null) field("Confidence", block.confidence); break;
      case "timeline": for (const entry of block.events) line(`${entry.date ?? "Undated"}: ${entry.label}${entry.done ? " (done)" : ""}`); break;
      case "actions":
        for (const action of block.actions) {
          if (action.tool === "open_lead" && typeof action.args?.id === "string") line(action.label, false, safeUrl(`/dashboard/pipeline/${encodeURIComponent(action.args.id)}`, baseUrl));
          else if (action.tool === "open_outbox") line(action.label, false, safeUrl("/dashboard/outbox", baseUrl));
          else if (action.tool === "ask") line(action.label);
        }
        break;
      case "sources":
        line(block.title ?? "Sources", true);
        for (const source of block.items) { const url = safeUrl(source.url, baseUrl); line(`${source.n != null ? `${source.n}. ` : ""}${source.title}`, false, url); if (!url) warnings.push("unsafe_source_url_omitted"); }
        break;
    }
    line("");
  }
  for (const action of actions) {
    line(action.label, true);
    field("Operation", action.tool);
    field("Action ID", action.id);
    field("State", action.state);
    line(JSON.stringify(action.args), false);
    if (action.state === "pending") line("Not executed. Confirmation is required.");
    else if (action.state === "succeeded") line(`Applied. ${JSON.stringify(action.result ?? {})}`);
    else if (action.state === "rejected") line("Rejected. No change was made.");
    else if (action.state === "indeterminate") line("Outcome uncertain. Verify the record before attempting another change.");
    else if (action.error) line(action.error);
  }
  return { format, messages: renderRuns(runs, format), blocks: visible, artifacts, warnings: [...new Set(warnings)] };
}