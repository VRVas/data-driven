"use client";

import { useState } from "react";
import { BrandEditor } from "@/components/BrandEditor";
import type { Brand } from "@/lib/types";

/** Opens the shared brand editor as a slide-over from the detail page. */
export function EditBrandButton({ brand }: { brand: Brand }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-full bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white shadow-[var(--shadow-glow)] transition-transform hover:scale-[1.03]"
      >
        Edit lead
      </button>
      {open && <BrandEditor brand={brand} onClose={() => setOpen(false)} />}
    </>
  );
}
