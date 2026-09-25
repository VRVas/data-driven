import { rm } from "node:fs/promises";
import path from "node:path";

export default async function setupRecoveryFixtures() {
  await rm(path.join(process.cwd(), ".data", "recovery-e2e"), { recursive: true, force: true });
  const base = `http://localhost:${process.env.RECOVERY_PW_PORT ?? 3200}`;
  for (const route of ["/signup", "/login", "/api/auth/session", "/api/admin/recovery/session", "/api/admin/recovery/upload",
    "/api/admin/recovery/backup", "/api/admin/recovery/jobs/fixture/download", "/api/admin/recovery", "/recovery"]) {
    const response = await fetch(`${base}${route}`);
    await response.arrayBuffer();
    if (response.status >= 500) throw new Error(`Recovery route warmup failed for ${route}: HTTP ${response.status}`);
  }
}