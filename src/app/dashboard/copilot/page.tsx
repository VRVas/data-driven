import { redirect } from "next/navigation";
import { Reveal } from "@/components/Reveal";
import { CopilotChat } from "@/components/CopilotChat";
import { getSessionUser } from "@/lib/auth/guards";
import { isFoundryConfigured } from "@/lib/copilot/provider";
import { isSpeechConfigured } from "@/lib/speech/provider";
import { isDocsConfigured } from "@/lib/copilot/documents";

export const dynamic = "force-dynamic";

export default async function CopilotPage() {
  const me = await getSessionUser();
  if (!me) redirect("/login");

  return (
    <div className="space-y-6">
      <Reveal>
        <div className="eyebrow mb-2">Foundry</div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Copilot</h1>
        <p className="mt-1 text-[var(--color-ink-muted)]">
          Chat with your pipeline — grounded in live data, acting as you.
        </p>
      </Reveal>
      <Reveal>
        <CopilotChat foundryEnabled={isFoundryConfigured()} voiceEnabled={isSpeechConfigured()} docsEnabled={isDocsConfigured()} />
      </Reveal>
    </div>
  );
}
