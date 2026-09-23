import { z } from "zod";
import { recoveryFailure, recoveryPermission } from "@/lib/recovery/auth";
import { recoveryJson, recoveryResponse } from "@/lib/recovery/http";
import { jobView, startBackup, startRecoveryWorker } from "@/lib/recovery/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await recoveryPermission("data:backup", request);
    const { password } = z.object({ password: z.string().min(12).max(512) }).strict().parse(await recoveryJson(request));
    const job = await startBackup(session.actor, password);
    startRecoveryWorker();
    return recoveryResponse(jobView(job), 202);
  } catch (error) { return recoveryFailure(error); }
}