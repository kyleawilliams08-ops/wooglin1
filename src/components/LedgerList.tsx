"use client";

import { useState } from "react";
import Link from "next/link";
import { fmtNet } from "@/lib/bets";

export interface LedgerEntry { id: string; name: string; net: number }

/** Year ledger with a client-side player-name search. */
export function LedgerList({ entries }: { entries: LedgerEntry[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle ? entries.filter((e) => e.name.toLowerCase().includes(needle)) : entries;

  return (
    <div className="space-y-2">
      <input
        type="search"
        placeholder="Search players…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm text-navy placeholder:text-navy/35 focus:border-navy focus:outline-none"
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-navy/50">No players match &ldquo;{q}&rdquo;.</p>
      ) : (
        <div className="rounded-xl border border-hairline bg-white divide-y divide-hairline">
          {filtered.map((e) => (
            <Link key={e.id} href={`/bets/player/${e.id}`}
              className="flex items-center justify-between px-4 py-2.5 hover:bg-parchment transition-colors">
              <span className="text-sm font-semibold text-navy">{e.name}</span>
              <span className="flex items-center gap-2">
                <span className={`text-sm font-bold tabular-nums ${e.net > 0 ? "text-europe-green" : e.net < 0 ? "text-usa-red" : "text-navy/50"}`}>
                  {fmtNet(e.net)}
                </span>
                <span className="text-navy/25">›</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
