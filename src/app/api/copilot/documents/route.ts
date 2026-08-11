import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { can } from "@/lib/auth/authorize";
import { isDocsConfigured, createVectorStore, uploadDocument, removeDocument } from "@/lib/copilot/documents";
import { getDocRegistryStore } from "@/lib/store/documents";

export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = /\.(pdf|docx?|txt|md|markdown|csv|json|pptx?|html?|rtf)$/i;

/** List the signed-in user's uploaded documents. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await can("copilot:documents"))) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!isDocsConfigured()) return Response.json({ files: [], enabled: false });
  const reg = await getDocRegistryStore().get(user.id);
  return Response.json({ files: reg.files, enabled: true });
}

/** Upload a document (multipart 'file') into the user's vector store. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await can("copilot:documents"))) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!isDocsConfigured()) return Response.json({ error: "Documents not configured" }, { status: 503 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
  if (file.size === 0) return Response.json({ error: "Empty file" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "File too large (max 25 MB)" }, { status: 413 });
  if (!ALLOWED.test(file.name)) return Response.json({ error: "Unsupported file type" }, { status: 415 });

  const store = getDocRegistryStore();
  try {
    const reg = await store.get(user.id);
    let vsId = reg.vectorStoreId;
    if (!vsId) {
      vsId = await createVectorStore(`docs-${user.id}`);
      await store.setVectorStore(user.id, vsId);
    }
    const doc = await uploadDocument(vsId, await file.arrayBuffer(), file.name, file.type);
    await store.addFile(user.id, doc);
    return Response.json({ file: doc });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

/** Remove a document (query param `fileId`). */
export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await can("copilot:documents"))) return Response.json({ error: "Forbidden" }, { status: 403 });
  const fileId = new URL(req.url).searchParams.get("fileId");
  if (!fileId) return Response.json({ error: "Missing fileId" }, { status: 400 });

  const store = getDocRegistryStore();
  const reg = await store.get(user.id);
  if (reg.vectorStoreId) await removeDocument(reg.vectorStoreId, fileId).catch(() => {});
  await store.removeFile(user.id, fileId);
  return Response.json({ ok: true });
}
