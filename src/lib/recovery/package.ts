import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, gzipSync } from "node:zlib";
import tar from "tar-stream";
import { z } from "zod";

export const PACKAGE_LIMIT = 32 * 1024 * 1024;
export const EXPANDED_LIMIT = 128 * 1024 * 1024;
const MAGIC = Buffer.from("OOVIEBK1\n");
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const SYSTEM_FIELDS = new Set(["_rid", "_self", "_etag", "_attachments", "_ts"]);
const object = z.record(z.unknown());
const definitionSchema = object.and(z.object({ id: z.string().regex(NAME), partitionKey: z.object({ paths: z.array(z.string().startsWith("/")).min(1).max(3) }).passthrough() }));
const manifestSchema = z.object({
  format: z.literal("oovie-cosmos-logical-backup"), version: z.literal(1),
  startedAt: z.string().datetime(), completedAt: z.string().datetime(), atomicSnapshot: z.boolean(),
  totals: z.object({ databases: z.literal(1), containers: z.number().int().min(1).max(100), documents: z.number().int().min(0).max(200000) }),
  containers: z.array(z.object({ database: z.string().regex(NAME), container: z.string().regex(NAME), documents: z.number().int().min(0), contentSha256: z.string().regex(/^[a-f0-9]{64}$/) })),
  files: z.array(z.object({ path: z.string(), bytes: z.number().int().min(0), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(2000),
  warnings: z.array(z.unknown()).default([]),
}).passthrough();

export type Document = Record<string, unknown> & { id: string };
export interface BackupContainer {
  definition: Record<string, unknown> & { id: string; partitionKey: { paths: string[]; [key: string]: unknown } };
  items: Document[];
  scripts: { storedProcedures: Record<string, unknown>[]; triggers: Record<string, unknown>[]; userDefinedFunctions: Record<string, unknown>[] };
}
export interface BackupPackage {
  database: string;
  containers: BackupContainer[];
  manifest: z.infer<typeof manifestSchema>;
  digest: string;
}

export class RecoveryError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); this.name = "RecoveryError"; }
}
export const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
export const contentHash = (items: unknown[]): string => sha256(items.map((item) => JSON.stringify(canonical(item))).sort().join("\n"));
export const portableDocument = (item: Document): Document => Object.fromEntries(Object.entries(item).filter(([key]) => !SYSTEM_FIELDS.has(key))) as Document;
export const portableHash = (items: Document[]): string => contentHash(items.map(portableDocument));

export function partitionValues(item: Document, paths: string[]): unknown[] {
  return paths.map((pointer) => pointer.split("/").slice(1).reduce<unknown>((value, part) => value && typeof value === "object"
    ? (value as Record<string, unknown>)[part.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined, item));
}
export function documentIdentity(item: Document, paths: string[]): string {
  return JSON.stringify([item.id, partitionValues(item, paths).map((value) => [value !== undefined, value ?? null])]);
}

function safePath(name: string): string {
  if (!name || name.includes("\\") || name.includes("\0") || name.startsWith("/") || name.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new RecoveryError("unsafe_archive", "The archive contains an unsafe path.");
  }
  return name;
}

export function encryptPackage(data: Buffer, password: string): Buffer {
  if (password.length < 12 || password.length > 512) throw new RecoveryError("password_required", "Use a backup password of 12 to 512 characters.");
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(MAGIC);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([MAGIC, salt, nonce, cipher.getAuthTag(), encrypted]);
}

export function decryptPackage(data: Buffer, password?: string): Buffer {
  if (!data.subarray(0, MAGIC.length).equals(MAGIC)) return data;
  if (!password || password.length > 512) throw new RecoveryError("password_required", "Enter this backup's password.");
  try {
    const offset = MAGIC.length;
    const key = scryptSync(password, data.subarray(offset, offset + 16), 32);
    const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(offset + 16, offset + 28));
    decipher.setAAD(MAGIC);
    decipher.setAuthTag(data.subarray(offset + 28, offset + 44));
    return Buffer.concat([decipher.update(data.subarray(offset + 44)), decipher.final()]);
  } catch { throw new RecoveryError("invalid_password", "The backup password is incorrect or the encrypted package is damaged."); }
}

export async function readPackage(input: Buffer, password?: string): Promise<BackupPackage> {
  if (!input.length || input.length > PACKAGE_LIMIT) throw new RecoveryError("package_too_large", "The backup must be smaller than 32 MiB.");
  const compressed = decryptPackage(input, password);
  const extractor = tar.extract();
  const files = new Map<string, Buffer>();
  let expanded = 0;
  let entries = 0;
  let root: string | undefined;
  let streamBytes = 0;
  const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    streamBytes += chunk.length;
    callback(streamBytes > EXPANDED_LIMIT ? new RecoveryError("package_too_large", "The expanded backup exceeds 128 MiB.") : null, chunk);
  } });
  extractor.on("entry", (header, stream, next) => {
    stream.on("error", (error) => extractor.destroy(error));
    try {
      if (++entries > 2500) throw new RecoveryError("package_too_large", "The archive contains too many entries.");
      const name = safePath(header.name.replace(/\/$/, ""));
      const parts = name.split("/");
      root ??= parts[0];
      if (parts[0] !== root) throw new RecoveryError("unsafe_archive", "The archive must have a single root directory.");
      if (header.type === "directory") { stream.resume(); stream.on("end", next); return; }
      if (header.type !== "file" || parts.length < 2) throw new RecoveryError("unsafe_archive", "Only ordinary files are accepted in a backup.");
      const relative = parts.slice(1).join("/");
      if (files.has(relative) || (header.size ?? 0) > EXPANDED_LIMIT) throw new RecoveryError("unsafe_archive", "The archive has duplicate or oversized files.");
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: unknown) => {
        if (!Buffer.isBuffer(chunk)) { extractor.destroy(new RecoveryError("invalid_archive", "Invalid archive data.")); return; }
        expanded += chunk.length;
        if (expanded > EXPANDED_LIMIT) { extractor.destroy(new RecoveryError("package_too_large", "The expanded backup exceeds 128 MiB.")); return; }
        chunks.push(chunk);
      });
      stream.on("end", () => { files.set(relative, Buffer.concat(chunks)); next(); });
    } catch (error) { stream.resume(); extractor.destroy(error as Error); }
  });
  try { await pipeline(Readable.from([compressed]), createGunzip(), bounded, extractor); }
  catch (error) { if (error instanceof RecoveryError) throw error; throw new RecoveryError("invalid_archive", "The tar.gz archive is invalid or incomplete."); }
  const json = (file: string): unknown => {
    const data = files.get(file);
    if (!data) throw new RecoveryError("missing_file", `The backup is missing ${file}.`);
    try { return JSON.parse(data.toString("utf8")); } catch { throw new RecoveryError("invalid_json", `Invalid JSON in ${file}.`); }
  };
  const parsed = manifestSchema.safeParse(json("manifest.json"));
  if (!parsed.success) throw new RecoveryError("invalid_manifest", "The backup manifest is invalid or uses an unsupported version.");
  const manifest = parsed.data;
  const expected = new Set<string>(["manifest.json"]);
  for (const file of manifest.files) {
    safePath(file.path);
    if (expected.has(file.path)) throw new RecoveryError("invalid_manifest", "Duplicate manifest entry.");
    expected.add(file.path);
    const actual = files.get(file.path);
    if (!actual || actual.length !== file.bytes || sha256(actual) !== file.sha256) throw new RecoveryError("checksum_mismatch", `Checksum failed for ${file.path}.`);
  }
  if ([...files.keys()].some((name) => !expected.has(name))) throw new RecoveryError("unlisted_file", "The archive contains files missing from its manifest.");
  const database = manifest.containers[0]?.database;
  if (!database || manifest.containers.some((entry) => entry.database !== database)) throw new RecoveryError("unsupported_database", "Import one application database at a time.");
  const containers: BackupContainer[] = [];
  const names = new Set<string>();
  for (const entry of manifest.containers) {
    if (names.has(entry.container)) throw new RecoveryError("invalid_manifest", "Duplicate container.");
    names.add(entry.container);
    const prefix = `databases/${database}/containers/${entry.container}`;
    const definition = definitionSchema.safeParse(json(`${prefix}/container.json`));
    if (!definition.success || definition.data.id !== entry.container) throw new RecoveryError("invalid_container", `Invalid definition for ${entry.container}.`);
    const raw = files.get(`${prefix}/items.ndjson`);
    if (!raw) throw new RecoveryError("missing_file", `Missing documents for ${entry.container}.`);
    let items: Document[];
    try { items = raw.toString("utf8").split("\n").filter((line) => line.trim()).map((line) => object.and(z.object({ id: z.string().min(1).max(1023) })).parse(JSON.parse(line))); }
    catch { throw new RecoveryError("invalid_document", `Invalid document in ${entry.container}.`); }
    if (items.length !== entry.documents || contentHash(items) !== entry.contentSha256) throw new RecoveryError("checksum_mismatch", `Document validation failed for ${entry.container}.`);
    if (new Set(items.map((item) => documentIdentity(item, definition.data.partitionKey.paths))).size !== items.length) throw new RecoveryError("duplicate_document", `Duplicate document identity in ${entry.container}.`);
    const scripts = z.object({ storedProcedures: z.array(object), triggers: z.array(object), userDefinedFunctions: z.array(object) }).safeParse(json(`${prefix}/scripts.json`));
    if (!scripts.success) throw new RecoveryError("invalid_scripts", "Invalid script inventory.");
    containers.push({ definition: definition.data, items, scripts: scripts.data });
  }
  if (containers.length !== manifest.totals.containers || containers.reduce((sum, container) => sum + container.items.length, 0) !== manifest.totals.documents) {
    throw new RecoveryError("invalid_manifest", "The backup totals do not match its contents.");
  }
  return { database, containers, manifest, digest: sha256(input) };
}

export async function writePackage(database: string, containers: BackupContainer[], startedAt: string, warnings: string[] = []): Promise<Buffer> {
  if (!NAME.test(database)) throw new RecoveryError("invalid_database", "Invalid database name.");
  const files = new Map<string, Buffer>();
  const add = (file: string, data: unknown) => files.set(file, Buffer.from(JSON.stringify(data)));
  add(`databases/${database}/database.json`, { id: database });
  for (const container of containers) {
    if (!NAME.test(container.definition.id)) throw new RecoveryError("invalid_container", "Invalid container name.");
    const prefix = `databases/${database}/containers/${container.definition.id}`;
    add(`${prefix}/container.json`, container.definition);
    files.set(`${prefix}/items.ndjson`, Buffer.from(container.items.map((item) => JSON.stringify(item)).join("\n")));
    add(`${prefix}/scripts.json`, container.scripts);
  }
  if ([...files.values()].reduce((sum, value) => sum + value.length, 0) > EXPANDED_LIMIT) throw new RecoveryError("package_too_large", "The dataset exceeds the backup size limit.");
  add("manifest.json", { format: "oovie-cosmos-logical-backup", version: 1, startedAt, completedAt: new Date().toISOString(), atomicSnapshot: false,
    totals: { databases: 1, containers: containers.length, documents: containers.reduce((sum, container) => sum + container.items.length, 0) }, warnings,
    containers: containers.map((container) => ({ database, container: container.definition.id, documents: container.items.length, contentSha256: contentHash(container.items) })),
    files: [...files].map(([name, data]) => ({ path: name, bytes: data.length, sha256: sha256(data) })) });
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  const collect = (async () => { for await (const chunk of pack) { if (!Buffer.isBuffer(chunk)) throw new RecoveryError("invalid_archive", "Invalid archive output."); chunks.push(chunk); } })();
  for (const [name, data] of files) pack.entry({ name: `backup/${name}`, size: data.length, mode: 0o600, mtime: new Date(0) }, data);
  pack.finalize();
  await collect;
  const result = gzipSync(Buffer.concat(chunks));
  if (result.length > PACKAGE_LIMIT - 128) throw new RecoveryError("package_too_large", "The compressed backup exceeds 32 MiB.");
  return result;
}