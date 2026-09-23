import { rm } from "node:fs/promises";
import path from "node:path";

export default async function setupRecoveryFixtures() {
  await rm(path.join(process.cwd(), ".data", "recovery-e2e"), { recursive: true, force: true });
  const base = `http://localhost:${process.env.RECOVERY_PW_PORT ?? 3200}`;
  for (const route of ["/signup", "/login", "/api/admin/recovery", "/recovery"]) {
    const response = await fetch(`${base}${route}`);
    await response.arrayBuffer();
  }
}