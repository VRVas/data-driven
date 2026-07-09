import { Reveal } from "@/components/Reveal";
import { AgentTable } from "@/components/AgentTable";
import { getAgents } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const agents = await getAgents();
  return (
    <div className="space-y-6">
      <Reveal>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Agents &amp; Agencies</h1>
        <p className="mt-1 text-[var(--color-ink-muted)]">
          The partner network — intermediaries, scouts and agencies that open doors.
          Fully editable, just like the brand pipeline.
        </p>
      </Reveal>
      <Reveal>
        <div className="glass p-6">
          <AgentTable agents={agents} />
        </div>
      </Reveal>
    </div>
  );
}
