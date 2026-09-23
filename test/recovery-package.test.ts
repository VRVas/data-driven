import { describe, expect, it } from "vitest";
import tar from "tar-stream";
import { gzipSync, gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { EXPANDED_LIMIT, readPackage, writePackage, encryptPackage, portableDocument, portableHash, type BackupContainer } from "@/lib/recovery/package";
import { prepareImport } from "@/lib/recovery/policy";

const fixture: BackupContainer = { definition: { id: "brands", partitionKey: { paths: ["/id"] } },
  items: [{ id: "fixture", name: "Synthetic company", _etag: "original", _ts: 123 }], scripts: { storedProcedures: [], triggers: [], userDefinedFunctions: [] } };

describe("portable recovery packages", () => {
  it.skipIf(!process.env.RECOVERY_PACKAGE_FIXTURE)("validates an existing operator backup without modifying it", async () => {
    const backup = await readPackage(await readFile(process.env.RECOVERY_PACKAGE_FIXTURE!));
    expect(backup.manifest.totals.containers).toBeGreaterThan(0);
    expect(backup.manifest.totals.documents).toBe(backup.containers.reduce((sum, container) => sum + container.items.length, 0));
    const planned = prepareImport(backup.containers, "full", []);
    expect(planned.containers.find((container) => container.definition.id === "users")!.items.length).toBeGreaterThan(0);
  });
  it("round trips a checksummed backup while preserving IDs and partition definitions", async () => {
    const buffer = await writePackage("bd", [fixture], new Date().toISOString());
    const backup = await readPackage(buffer);
    expect(backup.containers[0]).toEqual(fixture);
    expect(backup.manifest.totals.documents).toBe(1);
    expect(portableDocument(fixture.items[0])).toEqual({ id: "fixture", name: "Synthetic company" });
    expect(portableHash(fixture.items)).toBe(portableHash([{ ...fixture.items[0], _etag: "different", _ts: 456 }]));
  });

  it("authenticates encrypted archives and never accepts the wrong password", async () => {
    const input = await writePackage("bd", [fixture], new Date().toISOString());
    const encrypted = encryptPackage(input, "fixture-password-123");
    expect((await readPackage(encrypted, "fixture-password-123")).containers[0].items).toEqual(fixture.items);
    await expect(readPackage(encrypted)).rejects.toMatchObject({ code: "password_required" });
    await expect(readPackage(encrypted, "wrong-password")).rejects.toMatchObject({ code: "invalid_password" });
    encrypted[encrypted.length - 1] ^= 1;
    await expect(readPackage(encrypted, "fixture-password-123")).rejects.toMatchObject({ code: "invalid_password" });
  });

  it.each(["../outside", "/absolute", "backup/../escape", "backup\\escape"])("rejects unsafe archive path %s", async (name) => {
    const pack = tar.pack();
    const chunks: Buffer[] = [];
    const collect = (async () => { for await (const chunk of pack) { if (!Buffer.isBuffer(chunk)) throw new Error("Unexpected chunk"); chunks.push(chunk); } })();
    pack.entry({ name }, "fixture"); pack.finalize(); await collect;
    await expect(readPackage(gzipSync(Buffer.concat(chunks)))).rejects.toMatchObject({ code: "unsafe_archive" });
  });

  it("rejects duplicate document identities and truncated archives", async () => {
    const buffer = await writePackage("bd", [{ ...fixture, items: [...fixture.items, ...fixture.items] }], new Date().toISOString());
    await expect(readPackage(buffer)).rejects.toMatchObject({ code: "duplicate_document" });
    await expect(readPackage(buffer.subarray(0, 50))).rejects.toMatchObject({ code: "invalid_archive" });
  });

  it("rejects tampered file data before returning documents", async () => {
    const archive = gunzipSync(await writePackage("bd", [fixture], new Date().toISOString()));
    const position = archive.indexOf("Synthetic company");
    expect(position).toBeGreaterThan(0);
    archive[position] = "X".charCodeAt(0);
    await expect(readPackage(gzipSync(archive))).rejects.toMatchObject({ code: "checksum_mismatch" });
  });

  it.each(["symlink", "link"] as const)("rejects %s archive entries", async (type) => {
    const pack = tar.pack();
    const collect = (async () => { const chunks: Buffer[] = []; for await (const chunk of pack) if (Buffer.isBuffer(chunk)) chunks.push(chunk); return Buffer.concat(chunks); })();
    pack.entry({ name: "backup/linked", type, linkname: "/etc/passwd" }); pack.finalize();
    await expect(readPackage(gzipSync(await collect))).rejects.toMatchObject({ code: "unsafe_archive" });
  });

  it("bounds total decompression even when tar contains no file entries", async () => {
    const expanded = Buffer.alloc(EXPANDED_LIMIT + 1024);
    await expect(readPackage(gzipSync(expanded))).rejects.toMatchObject({ code: "package_too_large" });
  }, 10000);
});