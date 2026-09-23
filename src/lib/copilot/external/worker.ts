import "server-only";
import { integrationStore } from "./store";
import { processTask, recoverUncertainActions } from "./tasks";
import type { CopilotTask } from "./contracts";
import { assertOutboundAllowed, withDataset } from "@/lib/recovery/control";

let running = false;
let timer: ReturnType<typeof setInterval> | undefined;

export async function sweepCopilotJobs(): Promise<void> {
  if (running || process.env.COPILOT_EXTERNAL_ENABLED !== "true") return;
  running = true;
  try {
    await withDataset(async () => {
    await assertOutboundAllowed();
    const store = integrationStore();
    const tasks = await store.scan<CopilotTask>("task", { states: ["queued", "working"], limit: 100 });
    const available = tasks.filter((task) => !task.leaseUntil || Date.parse(task.leaseUntil) <= Date.now()).slice(0, 4);
    await Promise.allSettled(available.map((task) => processTask(task.partitionKey, task.id, store)));
    await recoverUncertainActions(store);
    });
  } catch (error) {
    console.error("[copilot worker] sweep failed", { name: error instanceof Error ? error.name : "UnknownError" });
  } finally { running = false; }
}

export function startCopilotWorker(): void {
  if (timer || process.env.COPILOT_EXTERNAL_ENABLED !== "true") return;
  timer = setInterval(() => { void sweepCopilotJobs(); }, 1500);
  timer.unref();
  void sweepCopilotJobs();
}