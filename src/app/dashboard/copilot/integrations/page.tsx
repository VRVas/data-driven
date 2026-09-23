import Link from "next/link";
import { requirePermission } from "@/lib/auth/authorize";
import { linkStatus } from "@/lib/copilot/external/telegram-link";
import { TelegramConnection } from "@/components/copilot/TelegramConnection";

export const dynamic = "force-dynamic";

export default async function CopilotIntegrationsPage() {
  const { user } = await requirePermission("copilot:use");
  const status = await linkStatus(user.id);
  return <div className="space-y-6">
    <Link href="/dashboard/copilot" className="text-sm text-[var(--color-ink-muted)]">Back to Copilot</Link>
    <h1 className="font-display text-3xl font-semibold">Connected accounts</h1>
    <TelegramConnection key={status.linked?.id ?? status.pending?.id ?? "unlinked"} {...status} />
  </div>;
}