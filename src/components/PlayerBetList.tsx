"use client";

import { useState } from "react";
import { fmtMoney, fmtNet } from "@/lib/bets";

export interface PlayerBetRow {
  id: string;
  title: string;
  participants: string;
  statusLabel: string;
  stake: number;
  net: number;
  settled: boolean;
}

/** A player's bet audit trail with a client-side search by bet name / who's in it. */
export function PlayerBetList({ rows }: { rows: PlayerBetRow[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? rows.filter((r) => `${r.title} ${r.participants}`.toLowerCase().includes(needle))
    : rows;

  return (
    <div className="space-y-2">
      <input
        type="search"
        placeholder="Search bets…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm text-navy placeholder:text-navy/35 focus:border-navy focus:outline-none"
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-navy/50">
          {needle ? `No bets match “${q}”.` : "No bets this year."}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => (
            <li key={r.id} className="rounded-xl border border-hairline bg-white px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-navy">{r.title}</p>
                  <p className="mt-0.5 truncate text-xs text-navy/50">{r.participants}</p>
                  <p className="mt-0.5 text-[11px] text-navy/40">{r.statusLabel} · {fmtMoney(r.stake)} stake</p>
                </div>
                <p className={`shrink-0 text-sm font-bold tabular-nums ${r.net > 0 ? "text-europe-green" : r.net < 0 ? "text-usa-red" : "text-navy/40"}`}>
                  {r.settled ? fmtNet(r.net) : "—"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
