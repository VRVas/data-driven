"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { getAgentStore } from "@/lib/store/agents";
import { AGENT_STATUSES, PRIORITIES } from "@/lib/vocab";
import type { Agent } from "@/lib/types";

export type AgentActionState = { ok?: boolean; error?: string } | undefined;

const emptyToUndef = (v: unknown) => (v === "" || v == null ? undefined : v);
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(emptyToUndef, z.enum(values).optional());
const optionalStr = z.preprocess(emptyToUndef, z.string().trim().optional());
const optionalDate = z.preprocess(
  emptyToUndef,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
);

const agentInputSchema = z.object({
  id: optionalStr,
  name: z.string().trim().min(1, "Name is required").max(120),
  status: optionalEnum(AGENT_STATUSES as unknown as [string, ...string[]]),
  priority: optionalEnum(PRIORITIES as unknown as [string, ...string[]]),
  owner: optionalStr,
  poc: optionalStr,
  initialContact: optionalDate,
  lastContact: optionalDate,
  followUp: optionalDate,
  notes: optionalStr,
});

function slug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .toLowerCase() || "agent"
  );
}

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
}

export async function saveAgent(_prev: AgentActionState, formData: FormData): Promise<AgentActionState> {
  await requireUser();

  const parsed = agentInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }
  const input = parsed.data;
  const store = getAgentStore();

  let agent: Agent;
  if (input.id) {
    const existing = await store.get(input.id);
    if (!existing) return { error: "That agent no longer exists." };
    agent = { ...existing };
  } else {
    let id = slug(input.name);
    if (await store.get(id)) id = `${id}-${Date.now().toString(36).slice(-4)}`;
    agent = {
      id,
      name: input.name,
      status: null,
      priority: null,
      owner: null,
      poc: null,
      initialContact: null,
      lastContact: null,
      followUp: null,
      notes: null,
    };
  }

  agent.name = input.name;
  agent.status = input.status ?? null;
  agent.priority = (input.priority as Agent["priority"]) ?? null;
  agent.owner = input.owner ?? null;
  agent.poc = input.poc ?? null;
  agent.initialContact = input.initialContact ?? null;
  agent.lastContact = input.lastContact ?? null;
  agent.followUp = input.followUp ?? null;
  agent.notes = input.notes ?? null;

  await store.save(agent);
  revalidatePath("/dashboard/agents");
  return { ok: true };
}

export async function deleteAgent(_prev: AgentActionState, formData: FormData): Promise<AgentActionState> {
  await requireUser();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing id." };

  await getAgentStore().remove(id);
  revalidatePath("/dashboard/agents");
  return { ok: true };
}
