import { externalPermission } from "@/lib/copilot/external/auth";
import { IntegrationError } from "@/lib/copilot/external/contracts";
import { integrationFailure } from "@/lib/copilot/external/http";
import { consumeQuota, getTask } from "@/lib/copilot/external/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string; artifactId: string }> }) {
  try {
    const caller = await externalPermission("copilot:use", request, "api");
    await consumeQuota(caller);
    const { id, artifactId } = await context.params;
    const artifact = (await getTask(caller, id)).result?.artifacts.find((entry) => entry.id === artifactId);
    if (!artifact) throw new IntegrationError(404, "artifact_not_found", "Artifact not found.");
    return new Response(artifact.text, { headers: { "content-type": `${artifact.mediaType}; charset=utf-8`, "cache-control": "no-store", "x-content-type-options": "nosniff", "content-disposition": `attachment; filename="${artifact.name}"` } });
  } catch (error) { return integrationFailure(error); }
}