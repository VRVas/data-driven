import { externalPermission } from "@/lib/copilot/external/auth";
import { integrationFailure, integrationResponse } from "@/lib/copilot/external/http";
import { integrationOpenApi } from "@/lib/copilot/external/openapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await externalPermission("copilot:use", request, "api");
    return integrationResponse(integrationOpenApi());
  } catch (error) { return integrationFailure(error); }
}