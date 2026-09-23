import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Safe read-modify-write for the local JSON stores.
 *
 * These files are rewritten whole, which is fine while every write comes from
 * a request. It stopped being fine when the reminder loop started writing from
 * a timer in the same process: a sweep and a click can interleave, and then
 * either one clobbers the other's change, or a reader catches the file
 * half-written and gets "Unexpected end of JSON input".
 *
 * Two fixes, both needed. A per-file promise chain serialises whole
 * read-modify-write cycles, so no update is computed from a stale read. And
 * writes go to a temp file and rename, which is atomic on POSIX, so a reader
 * sees either the old file or the new one and never a torn one.
 *
 * Cosmos needs none of this - it upserts single items - which is exactly why
 * the flaw only ever showed up in dev.
 */
const processState = globalThis as typeof globalThis & { __oovieFileLocks?: Map<string, Promise<unknown>> };
const chains = processState.__oovieFileLocks ??= new Map<string, Promise<unknown>>();

/** Run `job` with exclusive access to `file`, queued behind anything already running. */
export function withFileLock<T>(file: string, job: () => Promise<T>): Promise<T> {
  const previous = chains.get(file) ?? Promise.resolve();
  // Swallow the predecessor's rejection: one failed write must not poison the
  // queue for everything behind it.
  const next = previous.catch(() => undefined).then(job);
  chains.set(
    file,
    next.catch(() => undefined),
  );
  return next;
}

export async function readJsonArray<T>(file: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Write via a temp file and rename, so a concurrent reader never sees a partial file. */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(temp, file);
}

/** Read, transform and write back, all inside the lock. */
export function mutateJsonArray<T>(file: string, mutate: (rows: T[]) => T[] | Promise<T[]>): Promise<T[]> {
  return withFileLock(file, async () => {
    const next = await mutate(await readJsonArray<T>(file));
    await writeJsonAtomic(file, next);
    return next;
  });
}

/** As `mutateJsonArray`, for a file holding an object rather than an array. */
export async function readJsonObject<T extends object>(file: string, fallback: T): Promise<T> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as T;
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function mutateJsonObject<T extends object>(
  file: string,
  fallback: T,
  mutate: (current: T) => T | Promise<T>,
): Promise<T> {
  return withFileLock(file, async () => {
    const next = await mutate(await readJsonObject(file, fallback));
    await writeJsonAtomic(file, next);
    return next;
  });
}
