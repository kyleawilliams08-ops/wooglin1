"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

export interface LineupPlayer {
  id: string;       // event_participant id
  label: string;
  avatarUrl: string | null;
}

function initials(label: string) {
  return label.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

/**
 * Tappable roster grid for setting a team's lineup — same pattern as the
 * bet wizard's player pages. Tap to select (up to `max`; picking beyond
 * the cap swaps out the oldest pick), then Save.
 */
export function LineupPicker({
  players,
  max,
  initial,
  teamName,
  teamColor,
  action,
}: {
  players: LineupPlayer[];
  max: 1 | 2;
  initial: string[];
  teamName: string;
  teamColor: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const [sel, setSel] = useState<string[]>(initial.slice(0, max));
  const [q, setQ] = useState("");
  const [isPending, startTransition] = useTransition();

  const needle = q.trim().toLowerCase();
  const filtered = needle ? players.filter((p) => p.label.toLowerCase().includes(needle)) : players;

  const toggle = (id: string) => {
    setSel((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return [...prev, id].slice(-max); // newest picks win
    });
  };

  const save = () => {
    const fd = new FormData();
    fd.set("p1", sel[0] ?? "");
    fd.set("p2", sel[1] ?? "");
    startTransition(() => { void action(fd); });
  };

  const selNames = sel
    .map((id) => players.find((p) => p.id === id)?.label)
    .filter(Boolean)
    .join(" / ");

  return (
    <div className="space-y-3">
      <input
        type="search"
        placeholder="Search…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm text-navy placeholder:text-navy/35 focus:border-navy focus:outline-none"
      />

      <div className="grid grid-cols-3 gap-2">
        {filtered.map((p) => {
          const on = sel.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p.id)}
              className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition-colors ${
                on ? "border-transparent" : "border-hairline bg-white active:bg-parchment"
              }`}
              style={on ? { backgroundColor: teamColor } : undefined}
            >
              {p.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.avatarUrl} alt="" className="h-11 w-11 rounded-full object-cover ring-1 ring-gold/60" />
              ) : (
                <span className={`flex h-11 w-11 items-center justify-center rounded-full text-xs font-bold ring-1 ring-gold/60 ${
                  on ? "bg-off-white text-navy" : "bg-navy text-off-white"
                }`}>
                  {initials(p.label)}
                </span>
              )}
              <span className={`w-full truncate text-center text-xs font-semibold ${on ? "text-white" : "text-navy"}`}>
                {p.label}
              </span>
            </button>
          );
        })}
      </div>
      {filtered.length === 0 && <p className="text-sm text-navy/50">No one matches &ldquo;{q}&rdquo;.</p>}

      <button
        type="button"
        onClick={save}
        disabled={isPending || sel.length === 0}
        className="w-full rounded-xl py-3.5 text-base font-semibold text-white disabled:opacity-40"
        style={{ backgroundColor: teamColor }}
      >
        {isPending ? "Saving…" : sel.length === 0 ? "Pick your players" : `Save ${teamName} lineup: ${selNames}`}
      </button>
      {max === 2 && sel.length === 1 && (
        <p className="text-center text-[11px] text-navy/40">One player = playing 2v1. Tap a second for a pair.</p>
      )}
      <Link href="/matches" className="block text-center text-sm text-navy/50 hover:text-navy">
        Cancel
      </Link>
    </div>
  );
}
