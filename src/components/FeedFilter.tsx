"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const KINDS = [
  ["hole", "⛳ Holes"],
  ["match_final", "🏆 Match results"],
  ["standings", "📊 Standings"],
  ["lineup", "📋 Lineups"],
  ["bet", "💰 Bets"],
  ["draft", "🐉 Draft"],
  ["ctp", "🎯 CTP"],
] as const;

/**
 * Compact feed filter: a funnel icon that opens a bottom sheet of type
 * toggles. Selections apply instantly via ?kinds=; the header's
 * Clear-filters link (server-rendered) removes them.
 */
export function FeedFilter() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const selected = new Set((sp.get("kinds") ?? "").split(",").filter(Boolean));

  const toggle = (k: string) => {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    const v = Array.from(next).join(",");
    router.replace(v ? `${pathname}?kinds=${v}` : pathname, { scroll: false });
  };

  return (
    <>
      <button
        type="button"
        aria-label="Filter feed"
        onClick={() => setOpen(true)}
        className={selected.size > 0 ? "text-navy" : "text-navy/40 hover:text-navy"}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
          <path d="M3 5h18l-7 8v5l-4 2v-7L3 5Z" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-white p-4 pb-8 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-3 text-center text-sm font-semibold text-navy">Show only…</p>
            <div className="flex flex-wrap justify-center gap-2">
              {KINDS.map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggle(k)}
                  className={`rounded-full border px-3.5 py-2 text-sm font-semibold ${
                    selected.has(k)
                      ? "border-navy bg-navy text-off-white"
                      : "border-hairline bg-white text-navy/70"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-4 w-full rounded-lg bg-navy py-2.5 text-sm font-semibold text-off-white"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}
