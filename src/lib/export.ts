/**
 * Pure serializers for data export. No DOM — safe to unit-test and to import
 * anywhere. The browser side (Blob download, clipboard) lives in `download.ts`.
 */
export interface Column {
  key: string;
  label: string;
}

/** RFC-4180 CSV cell escaping. */
function escapeCsv(value: unknown): string {
  if (value == null) return "";
  const s = typeof value === "number" ? String(value) : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV string from a column spec + rows (values looked up by column key). */
export function toCsv(columns: Column[], rows: Record<string, unknown>[]): string {
  const header = columns.map((c) => escapeCsv(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => escapeCsv(r[c.key])).join(",")).join("\r\n");
  return body ? `${header}\r\n${body}` : header;
}

/** Pretty-printed JSON. */
export function toJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/** A date-stamped base filename, e.g. `pipeline-2026-07-11`. */
export function stampName(base: string, now: Date = new Date()): string {
  return `${base}-${now.toISOString().slice(0, 10)}`;
}
