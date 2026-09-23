import { z } from "zod";
import { recoveryFailure, recoveryPermission } from "@/lib/recovery/auth";
import { attachment, recoveryJson } from "@/lib/recovery/http";
import { getRecoveryJob, loadArtifact } from "@/lib/recovery/jobs";
import { encryptPackage, RecoveryError } from "@/lib/recovery/package";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await recoveryPermission("data:backup", request);
    const job = await getRecoveryJob((await params).id);
    if (job.status !== "completed" || !job.output) throw new RecoveryError("not_ready", "This backup is not ready to download.", 409);
    return attachment(await loadArtifact(job.output), `oovie-${job.id}.tar.gz.enc`);
  } catch (error) { return recoveryFailure(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await recoveryPermission("data:backup", request);
    const { password } = z.object({ password: z.string().min(12).max(512) }).strict().parse(await recoveryJson(request));
    const job = await getRecoveryJob((await params).id);
    if (!job.rollback) throw new RecoveryError("not_ready", "There is no rollback package for this operation.", 409);
    return attachment(encryptPackage(await loadArtifact(job.rollback), password), `oovie-before-${job.id}.tar.gz.enc`);
  } catch (error) { return recoveryFailure(error); }
}