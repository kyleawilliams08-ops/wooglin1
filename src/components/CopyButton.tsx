"use client";

import { useState } from "react";

/** Copies `text` to the clipboard; flips to "Copied" for a moment. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch { /* clipboard blocked — the text is selectable below */ }
      }}
      className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-off-white"
    >
      {done ? "✓ Copied" : label}
    </button>
  );
}
