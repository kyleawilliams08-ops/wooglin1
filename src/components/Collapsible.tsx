"use client";

import { useState } from "react";

/**
 * Space-saver for admin "add" forms: shows a "+ Label" button until tapped,
 * then reveals the form (server-rendered children) with a Cancel to collapse.
 * Pass defaultOpen when a validation error should keep it expanded.
 */
export function Collapsible({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-dashed border-hairline px-4 py-3 text-sm font-semibold text-navy/60 transition-colors hover:bg-parchment"
      >
        + {label}
      </button>
    );
  }

  return (
    <div className="space-y-2">
      {children}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="w-full text-center text-xs text-navy/50 hover:text-navy"
      >
        Cancel
      </button>
    </div>
  );
}
