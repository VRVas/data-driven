import { NextRequest } from "next/server";
import { apiPermission } from "@/lib/auth/api";
import { isDocsConfigured, createVectorStore, uploadDocument, removeDocument } from "@/lib/copilot/documents";
import { getDocRegistryStore } from "@/lib/store/documents";

export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = /\.(pdf|docx?|txt|md|markdown|csv|json|pptx?|html?|rtf)$/i;

/** List the signed-in user's uploaded documents. */
export async function GET() {
  const gate = await apiPermission("copilot:documents");
  if (gate instanceof Response) return gate;
  if (!isDocsConfigured()) return Response.json({ files: [], enabled: false });
  const reg = await getDocRegistryStore().get(gate.user.id);
  return Response.json({ files: reg.files, enabled: true });
}

/** Upload a document (multipart 'file') into the user's vector store. */
export async function POST(req: NextRequest) {
  const gate = await apiPermission("copilot:documents");
  if (gate instanceof Response) return gate;
  if (!isDocsConfigured()) return Response.json({ error: "Documents not configured" }, { status: 503 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
  if (file.size === 0) return Response.json({ error: "Empty file" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "File too large (max 25 MB)" }, { status: 413 });
  if (!ALLOWED.test(file.name)) return Response.json({ error: "Unsupported file type" }, { status: 415 });

  const store = getDocRegistryStore();
  try {
    const reg = await store.get(gate.user.id);
    let vsId = reg.vectorStoreId;
    if (!vsId) {
      vsId = await createVectorStore(`docs-${gate.user.id}`);
      await store.setVectorStore(gate.user.id, vsId);
    }
    const doc = await uploadDocument(vsId, await file.arrayBuffer(), file.name, file.type);
    await store.addFile(gate.user.id, doc);
    return Response.json({ file: doc });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

/** Remove a document (query param `fileId`). */
export async function DELETE(req: NextRequest) {
  const gate = await apiPermission("copilot:documents");
  if (gate instanceof Response) return gate;
  const fileId = new URL(req.url).searchParams.get("fileId");
  if (!fileId) return Response.json({ error: "Missing fileId" }, { status: 400 });

  const store = getDocRegistryStore();
  const reg = await store.get(gate.user.id);
  if (reg.vectorStoreId) await removeDocument(reg.vectorStoreId, fileId).catch(() => {});
  await store.removeFile(gate.user.id, fileId);
  return Response.json({ ok: true });
}
