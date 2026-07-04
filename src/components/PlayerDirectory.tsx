"use client";

import { useState } from "react";
import Link from "next/link";
import { formatHcp } from "@/lib/handicap";

export interface DirectoryPlayer {
  id: string;
  name: string;
  nickname: string | null;
  current_index: number | null;
  avatar_url: string | null;
  summary: { n: number; w: number; l: number; t: number } | null;
}

export function PlayerDirectory({ players }: { players: DirectoryPlayer[] }) {
  const [q, setQ] = useState("");

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? players.filter((p) =>
        p.name.toLowerCase().includes(needle) ||
        (p.nickname ?? "").toLowerCase().includes(needle),
      )
    : players;

  const initials = (p: DirectoryPlayer) =>
    (p.nickname ?? p.name).split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="space-y-3">
      <input
        type="search"
        placeholder="Search players…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm text-navy placeholder:text-navy/35 focus:border-navy focus:outline-none"
      />

      {filtered.length === 0 && (
        <p className="text-sm text-navy/50 px-1">No players match &ldquo;{q}&rdquo;.</p>
      )}

      <ul className="space-y-2">
        {filtered.map((p) => {
          const s = p.summary;
          return (
            <li key={p.id}>
              <Link
                href={`/players/${p.id}`}
                className="flex items-center gap-3 rounded-xl border border-hairline bg-white px-4 py-3 hover:bg-parchment transition-colors"
              >
                {p.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.avatar_url} alt={p.name}
                    className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-gold/60" />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy font-display text-sm font-bold text-off-white ring-1 ring-gold/60">
                    {initials(p)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-navy">
                    {p.nickname ?? p.name}
                    {p.nickname && p.nickname !== p.name && (
                      <span className="font-normal text-navy/40"> · {p.name}</span>
                    )}
                  </p>
                  <p className="text-xs text-navy/50">
                    {s
                      ? `${s.n} cup${s.n === 1 ? "" : "s"} · ${s.w}–${s.l}${s.t > 0 ? `–${s.t}` : ""}`
                      : "Rookie — no cups yet"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <p className="text-sm text-navy tabular-nums">{formatHcp(p.current_index)}</p>
                  <span className="text-navy/30">›</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
