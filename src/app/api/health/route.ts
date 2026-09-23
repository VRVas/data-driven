import { baselineDatabase, controlDatabaseName, rawDatabase, recoveryEnabled } from "@/lib/recovery/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
let cached: { healthy: boolean; until: number } | undefined;
let checking: Promise<boolean> | undefined;

export async function GET() {
  if (!cached || cached.until <= Date.now()) {
    checking ??= (async () => {
      try {
        if (process.env.COSMOS_ENDPOINT) {
          const options = { abortSignal: AbortSignal.timeout(5000) };
          if (recoveryEnabled()) await rawDatabase(controlDatabaseName())!.container("operations").read(options);
          else await rawDatabase(baselineDatabase())!.read(options);
        }
        return true;
      } catch { return false; }
    })();
    const healthy = await checking;
    cached = { healthy, until: Date.now() + (healthy ? 10000 : 1000) };
    checking = undefined;
  }
  return Response.json({ status: cached.healthy ? "ok" : "unavailable" }, { status: cached.healthy ? 200 : 503, headers });
}