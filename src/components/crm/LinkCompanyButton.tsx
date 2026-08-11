"use client";

import { useState } from "react";
import { LinkCompanyDrawer, type LinkableCompany } from "@/components/crm/LinkCompanyDrawer";

export function LinkCompanyButton({
  deal,
  companies,
}: {
  deal: { id: string; name: string; companyId: string };
  companies: LinkableCompany[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-[var(--color-border-strong)] px-3 py-1.5 text-sm hover:border-[var(--color-brand)]"
      >
        Link to company
      </button>
      {open && <LinkCompanyDrawer deal={deal} companies={companies} onClose={() => setOpen(false)} />}
    </>
  );
}
