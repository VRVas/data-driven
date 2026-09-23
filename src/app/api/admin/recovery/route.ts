import { z } from "zod";
import { recoveryFailure, recoveryPermission } from "@/lib/recovery/auth";
import { recoveryJson, recoveryResponse } from "@/lib/recovery/http";
import { changeControl, controlRecord, recoveryState, saveControl, type RecoveryState } from "@/lib/recovery/control";
import { cancelJob, confirmJob, getRecoveryJob, jobView, previewRollback, previewSeed, recentRecoveryJobs, startRecoveryWorker } from "@/lib/recovery/jobs";
import { RecoveryError } from "@/lib/recovery/package";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), id: z.string().uuid(), confirmation: z.string() }).strict(),
  z.object({ action: z.literal("cancel"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("seed"), administrator: z.object({ name: z.string(), email: z.string(), password: z.string().max(512) }).optional() }).strict(),
  z.object({ action: z.literal("rollback") }).strict(),
  z.object({ action: z.literal("delivery"), enabled: z.boolean(), confirmation: z.string() }).strict(),
]);

export async function GET(request: Request) {
  try {
    const session = await recoveryPermission("data:backup", request);
    startRecoveryWorker();
    const state = await recoveryState();
    return recoveryResponse({ actor: session.actor.name, permissions: session.permissions, expiresAt: session.expiresAt,
      environment: process.env.AZURE_ENV_NAME ?? (process.env.COSMOS_ENDPOINT ? new URL(process.env.COSMOS_ENDPOINT).hostname.split(".")[0] : "Local development"),
      state: { active: state.active, mode: state.mode, epoch: state.epoch, outboundPaused: state.outboundPaused, previous: state.previous, operation: state.operation },
      jobs: await recentRecoveryJobs() });
  } catch (error) { return recoveryFailure(error); }
}

export async function POST(request: Request) {
  try {
    const session = await recoveryPermission("data:restore", request);
    const input = commandSchema.parse(await recoveryJson(request));
    let result;
    if (input.action === "confirm") {
      const job = await getRecoveryJob(input.id);
      if (job.actor.id !== session.actor.id && session.actor.authority !== "recovery-key") throw new RecoveryError("different_reviewer", "Confirm using the same account that reviewed the upload.", 403);
      result = await confirmJob(input.id, input.confirmation);
    } else if (input.action === "cancel") result = await cancelJob(input.id);
    else if (input.action === "seed") result = await previewSeed(session.actor, input.administrator);
    else if (input.action === "rollback") result = await previewRollback(session.actor);
    else {
      if (input.confirmation !== (input.enabled ? "ENABLE DELIVERY" : "PAUSE DELIVERY")) throw new RecoveryError("confirmation_required", "Confirm the delivery change.");
      await changeControl<RecoveryState>("state", (state) => {
        if (state.mode !== "ready") throw new RecoveryError("maintenance", "Finish recovery before changing delivery.", 409);
        return { ...state, outboundPaused: !input.enabled };
      });
      await saveControl({ ...controlRecord("event", randomUUID()), actor: session.actor, action: input.enabled ? "delivery.enabled" : "delivery.paused" });
      return recoveryResponse({ ok: true });
    }
    startRecoveryWorker();
    return recoveryResponse(jobView(result), 202);
  } catch (error) { return recoveryFailure(error); }
}