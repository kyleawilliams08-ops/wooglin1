"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { matchOutcome, outcomeBadge, type HoleResult } from "@/lib/matchplay";
import type { SlotKey } from "@/lib/scoring";

const TERMS: Record<number, string> = {
  [-3]: "Alba", [-2]: "Eagle", [-1]: "Birdie", [0]: "Par",
  [1]: "Bogey", [2]: "Dbl", [3]: "Trpl", [4]: "Quad",
};

export interface HbhSlot {
  key: SlotKey;
  side: "home" | "away";
  label: string;   // player name, or team name for one-score formats
  sub: string | null;
}

export interface HbhHole {
  n: number;       // hole number
  par: number;
  si: number;
  strokes: Partial<Record<SlotKey, number>>; // strokes received per slot (0.5 steps)
}

type Scores = Record<number, Partial<Record<SlotKey, number | null>>>;

/**
 * Mobile-first, one-hole-at-a-time scorer. Taps save immediately via the
 * server action; auto-advances when every ball on the hole has a score.
 */
export function HoleByHole({
  slots,
  holes,
  initialScores,
  startIndex,
  canScore,
  homeLabel,
  awayLabel,
  homeColor,
  awayColor,
  cardHref,
  reviewHref,
  backHref,
  saveScore,
}: {
  slots: HbhSlot[];
  holes: HbhHole[];
  initialScores: Scores;
  startIndex: number;
  canScore: boolean;
  homeLabel: string;
  awayLabel: string;
  homeColor: string | null;
  awayColor: string | null;
  cardHref: string;
  reviewHref: string;
  backHref: string;
  saveScore: (holeNumber: number, slot: SlotKey, value: number | null) => Promise<void>;
}) {
  const [scores, setScores] = useState<Scores>(initialScores);
  const [idx, setIdx] = useState(Math.min(Math.max(startIndex, 0), holes.length - 1));
  const [expanded, setExpanded] = useState<SlotKey | null>(null);
  const [, startTransition] = useTransition();
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adopt server state on realtime refreshes (a save echoes back our own value).
  useEffect(() => { setScores(initialScores); }, [initialScores]);
  useEffect(() => () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); }, []);

  const hole = holes[idx];

  // Per-hole result from local state: best net per side once each side has a ball in.
  const holeResult = (h: HbhHole): HoleResult => {
    const s = scores[h.n] ?? {};
    const nets = (side: "home" | "away") =>
      slots
        .filter((sl) => sl.side === side)
        .map((sl) => (s[sl.key] != null ? (s[sl.key] as number) - (h.strokes[sl.key] ?? 0) : null))
        .filter((v): v is number => v != null);
    const home = nets("home");
    const away = nets("away");
    if (home.length === 0 || away.length === 0) return null;
    const bh = Math.min(...home);
    const ba = Math.min(...away);
    return bh < ba ? "home" : ba < bh ? "away" : "halve";
  };

  const results = holes.map(holeResult);
  const outcome = matchOutcome(results, holes.length);
  const badge = outcomeBadge(outcome, homeLabel, awayLabel);

  const pick = (slot: SlotKey, value: number | null) => {
    if (!canScore) return;
    const h = hole;
    const next: Scores = { ...scores, [h.n]: { ...(scores[h.n] ?? {}), [slot]: value } };
    setScores(next);
    setExpanded(null);
    startTransition(() => { void saveScore(h.n, slot, value); });

    // Auto-advance once every ball on this hole has a score.
    const complete = slots.every((sl) => next[h.n]?.[sl.key] != null);
    if (complete && idx < holes.length - 1 && value != null) {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      advanceTimer.current = setTimeout(() => setIdx((i) => Math.min(i + 1, holes.length - 1)), 450);
    }
  };

  const goTo = (i: number) => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setExpanded(null);
    setIdx(Math.min(Math.max(i, 0), holes.length - 1));
  };

  const teamColor = (side: "home" | "away") =>
    side === "home" ? homeColor ?? "#0C2D55" : awayColor ?? "#0C2D55";

  const strokeMarks = (n: number | undefined) => {
    const s = n ?? 0;
    if (s <= 0) return null;
    return (
      <span className="ml-1.5">
        <span className="text-xs text-navy/50">{"●".repeat(Math.floor(s))}</span>
        {s % 1 > 0 && <span className="text-xs text-amber-500">½</span>}
      </span>
    );
  };

  return (
    <div className="px-4 py-5 pb-8 space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <Link href={backHref} className="text-sm text-navy/50 hover:text-navy">← Live</Link>
        <Link href={cardHref} className="text-sm font-medium text-navy/60 underline underline-offset-2">
          Full scorecard
        </Link>
      </div>

      {/* Match status */}
      {badge && (
        <div className="rounded-xl bg-navy px-4 py-2.5 text-center">
          <p className="text-white font-bold">{badge}</p>
        </div>
      )}

      {/* Hole strip: jump anywhere, colored by result */}
      <div className="grid grid-cols-9 gap-1.5">
        {holes.map((h, i) => {
          const r = results[i];
          const active = i === idx;
          const bg = r === "home" ? teamColor("home")
            : r === "away" ? teamColor("away")
            : null;
          return (
            <button
              key={h.n}
              type="button"
              onClick={() => goTo(i)}
              className={`h-8 rounded-md text-xs font-semibold tabular-nums border transition-colors ${
                active ? "border-navy ring-1 ring-navy" : "border-hairline"
              } ${r === "halve" ? "bg-hairline text-navy/60" : r ? "text-white" : "bg-white text-navy/50"}`}
              style={bg ? { backgroundColor: bg } : undefined}
            >
              {h.n}
            </button>
          );
        })}
      </div>

      {/* Current hole header */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-3xl font-display font-bold text-navy leading-none">Hole {hole.n}</p>
          <p className="text-sm text-navy/50 mt-1">Par {hole.par} · SI {hole.si}</p>
        </div>
        <p className="text-xs text-navy/40 mb-1">{idx + 1} of {holes.length}</p>
      </div>

      {/* One section per ball */}
      <div className="space-y-3">
        {slots.map((sl) => {
          const current = scores[hole.n]?.[sl.key] ?? null;
          const isExpanded = expanded === sl.key;

          const primary: { score: number; term: string }[] = [];
          for (let d = -2; d <= 3; d++) {
            const score = hole.par + d;
            if (score < 1) continue;
            primary.push({ score, term: TERMS[d] ?? `+${d}` });
          }
          const extras: number[] = [];
          if (hole.par - 3 >= 1) extras.push(hole.par - 3);
          for (let d = 4; d <= 7; d++) {
            if (hole.par + d <= 15) extras.push(hole.par + d);
          }

          return (
            <div key={sl.key} className="rounded-xl border border-hairline bg-white px-3 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold flex items-center" style={{ color: teamColor(sl.side) }}>
                  {sl.label}
                  {strokeMarks(hole.strokes[sl.key])}
                </p>
                {sl.sub && <p className="text-xs text-navy/40">{sl.sub}</p>}
              </div>

              {canScore ? (
                <>
                  <div className="grid grid-cols-6 gap-1.5">
                    {primary.map(({ score, term }) => (
                      <button
                        key={score}
                        type="button"
                        onClick={() => pick(sl.key, score)}
                        className={`rounded-lg py-2.5 flex flex-col items-center border transition-colors ${
                          score === current
                            ? "bg-navy text-white border-navy"
                            : score === hole.par
                            ? "border-navy/50 bg-parchment text-navy"
                            : "border-hairline bg-white text-navy active:bg-parchment"
                        }`}
                      >
                        <span className="text-lg font-bold leading-none tabular-nums">{score}</span>
                        <span className={`text-[9px] mt-0.5 ${score === current ? "text-white/70" : "text-navy/45"}`}>
                          {term}
                        </span>
                      </button>
                    ))}
                  </div>
                  {isExpanded ? (
                    <div className="mt-1.5 flex gap-1.5">
                      {extras.map((s) => (
                        <button key={s} type="button" onClick={() => pick(sl.key, s)}
                          className={`flex-1 rounded-lg py-2 text-sm tabular-nums border ${
                            s === current ? "bg-navy text-white border-navy" : "border-hairline bg-white text-navy"
                          }`}>
                          {s}
                        </button>
                      ))}
                      <button type="button" onClick={() => pick(sl.key, null)}
                        className="flex-1 rounded-lg py-2 text-sm border border-hairline text-navy/50 bg-white">
                        Clear
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setExpanded(sl.key)}
                      className="mt-1.5 w-full text-center text-xs text-navy/40 py-1">
                      more scores…
                    </button>
                  )}
                </>
              ) : (
                <p className="text-2xl font-bold tabular-nums text-navy">
                  {current ?? <span className="text-navy/25 text-base">no score yet</span>}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Hole result */}
      {results[idx] && (
        <p className="text-center text-sm font-semibold" style={{
          color: results[idx] === "halve" ? "#0C2D5566" : teamColor(results[idx] as "home" | "away"),
        }}>
          {results[idx] === "halve" ? "Hole halved" : `Hole to ${results[idx] === "home" ? homeLabel : awayLabel}`}
        </p>
      )}

      {/* Prev / Next */}
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => goTo(idx - 1)} disabled={idx === 0}
          className="rounded-lg border border-hairline bg-white py-3 text-sm font-semibold text-navy disabled:opacity-30">
          ← Hole {idx > 0 ? holes[idx - 1].n : ""}
        </button>
        <button type="button" onClick={() => goTo(idx + 1)} disabled={idx === holes.length - 1}
          className="rounded-lg border border-navy bg-navy py-3 text-sm font-semibold text-off-white disabled:opacity-30">
          Hole {idx < holes.length - 1 ? holes[idx + 1].n : ""} →
        </button>
      </div>

      {/* Review & complete once anything is scored */}
      {canScore && outcome.holesPlayed > 0 && (
        <Link href={reviewHref}
          className="block w-full rounded-lg bg-europe-green py-3 text-center text-sm font-semibold text-white">
          Review &amp; Complete Match →
        </Link>
      )}
    </div>
  );
}
