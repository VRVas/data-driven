"use client";

import { useState } from "react";
import { BrandEditor } from "@/components/BrandEditor";

/**
 * Start a new engagement with a client we already know.
 *
 * The company page could only add a proposal, so an early conversation with no
 * brief and no numbers had nowhere to live - the only way to record it was to
 * invent a proposal for work that had not been scoped.
 */
export function NewDealButton({ company }: { company: { id: string; name: string } }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-[var(--color-brand)] px-4 py-1.5 text-sm font-semibold text-[var(--color-on-brand)] transition-transform hover:scale-[1.03]"
      >
        New deal
      </button>
      {open && <BrandEditor brand={null} company={company} onClose={() => setOpen(false)} />}
    </>
  );
}
