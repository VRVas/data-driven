import { Badge } from "@/components/Badge";
import type { ProposalStatus } from "@/lib/crm/types";

/** Only `sent` is amber — it's the one status that still needs an answer. */
const TONE: Record<ProposalStatus, string> = {
  accepted: "var(--color-mint)",
  rejected: "var(--color-rose)",
  expired: "var(--color-rose)",
  sent: "var(--color-amber)",
  draft: "var(--color-ink-faint)",
  withdrawn: "var(--color-ink-faint)",
};

export function ProposalStatusPill({ status }: { status: ProposalStatus }) {
  return <Badge color={TONE[status]}>{status[0].toUpperCase() + status.slice(1)}</Badge>;
}
