import { NextRequest, NextResponse } from "next/server";
import { COPILOT_TOOLS } from "@/lib/copilot/tools";

export const dynamic = "force-dynamic";

/**
 * OpenAPI 3.0 document describing the copilot tools. Register this URL as an
 * OpenAPI tool on the Foundry agent (auth: managed identity in prod, or the
 * `x-api-key` header backed by COPILOT_API_KEY).
 */
export function GET(req: NextRequest) {
  const origin = process.env.APP_URL ?? req.nextUrl.origin;
  const paths: Record<string, unknown> = {};
  for (const t of COPILOT_TOOLS) {
    paths[`/api/copilot/tools/${t.name}`] = {
      post: {
        operationId: t.name,
        summary: t.description,
        requestBody: {
          required: true,
          content: { "application/json": { schema: t.parameters } },
        },
        responses: {
          "200": {
            description: "Tool result",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
        security: [{ ApiKeyAuth: [] }],
      },
    };
  }

  return NextResponse.json({
    openapi: "3.0.1",
    info: {
      title: "OOVIE BD Copilot Tools",
      version: "1.0.0",
      description: "Typed, grounded tools over the BD pipeline for the Foundry agent.",
    },
    servers: [{ url: origin }],
    paths,
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
      },
    },
  });
}
