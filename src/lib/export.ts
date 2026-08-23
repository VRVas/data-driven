/**
 * Pure serializers for data export. No DOM - safe to unit-test and to import
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

// ---------------------------------------------------------------------------
//  Binary formats - .xlsx (Office Open XML) and .pdf, hand-rolled so the app
//  stays dependency-free (same philosophy as the RFC-4180 CSV above). Both
//  return raw bytes; the browser side (`download.ts`) wraps them in a Blob.
// ---------------------------------------------------------------------------

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const u16 = (n: number) => Uint8Array.from([n & 0xff, (n >>> 8) & 0xff]);
const u32 = (n: number) =>
  Uint8Array.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal ZIP writer (STORED / no compression) - enough for a valid .xlsx. */
function zipSync(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;
    const local = concatBytes([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0),
      nameBytes, e.data,
    ]);
    locals.push(local);
    central.push(
      concatBytes([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(offset), nameBytes,
      ]),
    );
    offset += local.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) centralSize += c.length;
  const eocd = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralSize), u32(centralStart), u16(0),
  ]);
  return concatBytes([...locals, ...central, eocd]);
}

function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || "A";
}

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Build a single-sheet `.xlsx` workbook (inline strings + numeric cells). */
export function toXlsx(columns: Column[], rows: Record<string, unknown>[]): Uint8Array {
  const enc = new TextEncoder();
  const nCols = Math.max(columns.length, 1);

  const cell = (ref: string, value: unknown): string => {
    if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
    if (value == null || value === "") return `<c r="${ref}"/>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escXml(String(value))}</t></is></c>`;
  };

  let sheetRows = `<row r="1">${columns
    .map((c, i) => `<c r="${colLetter(i + 1)}1" t="inlineStr"><is><t xml:space="preserve">${escXml(c.label)}</t></is></c>`)
    .join("")}</row>`;
  rows.forEach((row, ri) => {
    const r = ri + 2;
    sheetRows += `<row r="${r}">${columns.map((c, i) => cell(`${colLetter(i + 1)}${r}`, row[c.key])).join("")}</row>`;
  });

  const dim = `A1:${colLetter(nCols)}${rows.length + 1}`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dim}"/><sheetData>${sheetRows}</sheetData></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

  return zipSync([
    { name: "[Content_Types].xml", data: enc.encode(contentTypes) },
    { name: "_rels/.rels", data: enc.encode(rootRels) },
    { name: "xl/workbook.xml", data: enc.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(workbookRels) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheet) },
  ]);
}

/** Latin-1 encode (each char -> one byte). Callers keep content ASCII. */
const latin1 = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 0xff);
const sanitizePdf = (s: string) => String(s ?? "").replace(/[^\x20-\x7E]/g, (ch) => (ch === "-" || ch === "-" ? "-" : "?"));
const escPdf = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** Build a paginated, landscape `.pdf` table (Helvetica, no font embedding). */
export function toPdf(title: string, columns: Column[], rows: Record<string, unknown>[]): Uint8Array {
  const pageW = 842;
  const pageH = 595; // A4 landscape (points)
  const margin = 40;
  const contentW = pageW - margin * 2;
  const bodySize = 9;
  const rowH = 15;
  const charW = bodySize * 0.5;

  // Column widths proportional to sampled content length (clamped), fit to width.
  const sample = rows.slice(0, 200);
  const weights = columns.map((c) => {
    let w = c.label.length;
    for (const r of sample) w = Math.max(w, String(r[c.key] ?? "").length);
    return Math.min(Math.max(w, 4), 42);
  });
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  const colW = weights.map((w) => (w / totalW) * contentW);
  const colX: number[] = [];
  let x = margin;
  for (const w of colW) {
    colX.push(x);
    x += w;
  }
  const fit = (s: unknown, w: number) => {
    const t = sanitizePdf(String(s ?? ""));
    const max = Math.max(1, Math.floor(w / charW) - 1);
    return t.length > max ? `${t.slice(0, Math.max(1, max - 1))}...` : t;
  };

  const titleBaseline = pageH - margin - 4;
  const subBaseline = titleBaseline - 18;
  const headBaseline = subBaseline - 24;
  const firstRowBaseline = headBaseline - rowH;
  const bottomLimit = margin + 8;
  const rowsPerPage = Math.max(1, Math.floor((firstRowBaseline - bottomLimit) / rowH) + 1);

  const pages: Record<string, unknown>[][] = [];
  for (let i = 0; i < Math.max(rows.length, 1); i += rowsPerPage) pages.push(rows.slice(i, i + rowsPerPage));

  const streamFor = (slice: Record<string, unknown>[], pageIndex: number): string => {
    let s = `BT /F2 16 Tf 1 0 0 1 ${margin} ${titleBaseline} Tm (${escPdf(sanitizePdf(title))}) Tj ET\n`;
    const sub = `${rows.length} row(s) - exported ${new Date().toISOString().slice(0, 10)} - page ${pageIndex + 1}/${pages.length}`;
    s += `BT /F1 9 Tf 1 0 0 1 ${margin} ${subBaseline} Tm (${escPdf(sanitizePdf(sub))}) Tj ET\n`;
    s += `BT /F2 9 Tf`;
    columns.forEach((c, i) => {
      s += ` 1 0 0 1 ${colX[i].toFixed(1)} ${headBaseline} Tm (${escPdf(fit(c.label, colW[i]))}) Tj`;
    });
    s += ` ET\n`;
    s += `0.82 0.82 0.78 RG 0.6 w ${margin} ${(headBaseline - 5).toFixed(1)} m ${(margin + contentW).toFixed(1)} ${(headBaseline - 5).toFixed(1)} l S\n`;
    s += `BT /F1 ${bodySize} Tf`;
    slice.forEach((r, ri) => {
      const y = firstRowBaseline - ri * rowH;
      columns.forEach((c, i) => {
        s += ` 1 0 0 1 ${colX[i].toFixed(1)} ${y.toFixed(1)} Tm (${escPdf(fit(r[c.key], colW[i]))}) Tj`;
      });
    });
    s += ` ET\n`;
    return s;
  };

  // Objects: 1 Catalog, 2 Pages, 3 Font, 4 Font-Bold, then (content, page) per page.
  const bodies: string[] = [];
  bodies[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  bodies[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  bodies[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`;

  const pageObjNums: number[] = [];
  let next = 5;
  pages.forEach((slice, pi) => {
    const contentNum = next++;
    const pageNum = next++;
    const content = streamFor(slice, pi);
    bodies[contentNum] = `<< /Length ${latin1(content).length} >>\nstream\n${content}\nendstream`;
    bodies[pageNum] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNum} 0 R >>`;
    pageObjNums.push(pageNum);
  });
  bodies[2] = `<< /Type /Pages /Kids [ ${pageObjNums.map((n) => `${n} 0 R`).join(" ")} ] /Count ${pageObjNums.length} >>`;

  const maxObj = next - 1;
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (u8: Uint8Array) => {
    parts.push(u8);
    pos += u8.length;
  };
  push(latin1("%PDF-1.4\n"));
  for (let n = 1; n <= maxObj; n++) {
    offsets[n] = pos;
    push(latin1(`${n} 0 obj\n${bodies[n]}\nendobj\n`));
  }
  const xrefStart = pos;
  let xref = `xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= maxObj; n++) xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  push(latin1(xref));
  push(latin1(`trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`));
  return concatBytes(parts);
}
