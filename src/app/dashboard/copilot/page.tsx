import { redirect } from "next/navigation";
import Link from "next/link";
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
        <h1 className="font-display text-3xl font-semibold tracking-tight">Copilot</h1>
        <p className="mt-1 text-[var(--color-ink-muted)]">
          Chat with your pipeline - grounded in live data, acting as you.
        </p>
        <Link href="/dashboard/copilot/integrations" className="mt-2 inline-block text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">Connected accounts</Link>
      </Reveal>
      <Reveal>
        <CopilotChat foundryEnabled={isFoundryConfigured()} voiceEnabled={isSpeechConfigured()} docsEnabled={isDocsConfigured()} />
      </Reveal>
    </div>
  );
}
