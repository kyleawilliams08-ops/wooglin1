"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const WHO = [["all", "All bets"], ["me", "My bets"]] as const;
const STATUS = [["all", "All"], ["open", "Open"], ["settled", "Settled"], ["protested", "⚠️ Protested"]] as const;

/**
 * History filter: a funnel icon (same pattern as the clubhouse FeedFilter)
 * opening a bottom sheet with "who" and "status" groups. Applies via
 * ?who=/?status= while preserving the ?tab= param; the header shows a Clear
 * link when anything is set.
 */
export function BetFilter() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const who = sp.get("who") === "me" ? "me" : "all";
  const status = ["open", "settled", "protested"].includes(sp.get("status") ?? "") ? sp.get("status")! : "all";
  const activeCount = (who !== "all" ? 1 : 0) + (status !== "all" ? 1 : 0);

  const set = (key: string, val: string) => {
    const next = new URLSearchParams(sp.toString());
    if (val === "all") next.delete(key);
    else next.set(key, val);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const group = (
    label: string,
    key: string,
    current: string,
    opts: readonly (readonly [string, string])[],
  ) => (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-navy/40">{label}</p>
      <div className="flex flex-wrap gap-2">
        {opts.map(([v, l]) => (
          <button key={v} type="button" onClick={() => set(key, v)}
            className={`rounded-full border px-3.5 py-2 text-sm font-semibold ${
              current === v ? "border-navy bg-navy text-off-white" : "border-hairline bg-white text-navy/70"
            }`}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <button type="button" aria-label="Filter bets" onClick={() => setOpen(true)}
        className={`flex items-center gap-1 ${activeCount > 0 ? "text-navy" : "text-navy/40 hover:text-navy"}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
          <path d="M3 5h18l-7 8v5l-4 2v-7L3 5Z" strokeLinejoin="round" />
        </svg>
        {activeCount > 0 && (
          <span className="rounded-full bg-navy px-1.5 text-[10px] font-bold text-off-white">{activeCount}</span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute bottom-0 left-0 right-0 space-y-4 rounded-t-2xl bg-white p-4 pb-8 shadow-xl"
            onClick={(e) => e.stopPropagation()}>
            <p className="text-center text-sm font-semibold text-navy">Filter bets</p>
            {group("Show", "who", who, WHO)}
            {group("Status", "status", status, STATUS)}
            <button type="button" onClick={() => setOpen(false)}
              className="w-full rounded-lg bg-navy py-2.5 text-sm font-semibold text-off-white">
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}
