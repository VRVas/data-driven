import { recoveryFailure, recoveryPermission } from "@/lib/recovery/auth";
import { boundedBody, recoveryResponse } from "@/lib/recovery/http";
import { jobView, previewImport } from "@/lib/recovery/jobs";
import { PACKAGE_LIMIT, RecoveryError } from "@/lib/recovery/package";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await recoveryPermission("data:restore", request);
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) throw new RecoveryError("invalid_upload", "Select a backup package.");
    const raw = await boundedBody(request, PACKAGE_LIMIT + 65536);
    const form = await new Response(new Uint8Array(raw), { headers: { "content-type": request.headers.get("content-type")! } }).formData();
    const file = form.get("file");
    const password = form.get("password") ?? "";
    const mode = form.get("mode");
    if (!(file instanceof File) || typeof password !== "string" || password.length > 512 || !["full", "crm"].includes(String(mode))) throw new RecoveryError("invalid_upload", "Select a valid package and import mode.");
    const job = await previewImport(session.actor, Buffer.from(await file.arrayBuffer()), password || undefined, mode as "full" | "crm");
    return recoveryResponse(jobView(job), 201);
  } catch (error) { return recoveryFailure(error); }
}