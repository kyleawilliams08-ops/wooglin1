"use client";

import { useState } from "react";
import Link from "next/link";

export interface CardMenuItem {
  href: string;
  label: string;
  newTab?: boolean;
}

/** Ellipsis dropdown for secondary card actions (admin tools etc.). */
export function CardMenu({ items }: { items: CardMenuItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="More actions"
        onClick={() => setOpen((o) => !o)}
        className="rounded px-1.5 py-1 text-navy/40 hover:text-navy"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-30 mt-1 w-36 rounded-lg border border-hairline bg-white py-1 shadow-lg">
            {items.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                target={i.newTab ? "_blank" : undefined}
                onClick={() => setOpen(false)}
                className="block px-3 py-2 text-sm text-navy hover:bg-parchment"
              >
                {i.label}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
