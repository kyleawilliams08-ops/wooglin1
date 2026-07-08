"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { makeLineupPick, undoLastLineupPick } from "@/lib/lineupDraftActions";
import { teamIndexForPick, clockRemaining } from "@/lib/draft";
import { formatHcp } from "@/lib/handicap";

export interface LineupTeam { id: string; name: string; color: string; captainName: string | null }
export interface SidePlayer { id: string; name: string; avatarUrl: string | null }
export interface LineupMatchupView {
  id: string;
  matchNumber: number;
  home: { p1: SidePlayer | null; p2: SidePlayer | null };
  away: { p1: SidePlayer | null; p2: SidePlayer | null };
}
export interface RosterPlayer { id: string; name: string; avatarUrl: string | null; index: number | null }
export interface LineupPickView { pickNumber: number; teamId: string; names: string[] }

export interface LineupDraftView {
  id: string;
  status: "scheduled" | "live" | "complete";
  roundNumber: number;
  roundName: string | null;
  eventName: string;
  sideSize: 1 | 2;
  pickSeconds: number;
  currentPickStartedAt: string | null;
  /** Board order: [home, away] (home = first team by name) */
  homeTeam: LineupTeam;
  awayTeam: LineupTeam;
  firstPickTeamId: string;
  matchups: LineupMatchupView[];
  /** Full roster per team id */
  rosters: Record<string, RosterPlayer[]>;
  picks: LineupPickView[];
  captainOf: string | null;
  viewerIsAdmin: boolean;
}

function Avatar({ url, name, color, className }: {
  url: string | null; name: string; color: string; className: string;
}) {
  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={name} className={`rounded-full object-cover ${className}`} />
  ) : (
    <span className={`flex items-center justify-center rounded-full font-bold text-off-white ${className}`}
      style={{ backgroundColor: color }}>
      {initials}
    </span>
  );
}

function fmtClock(s: number) {
  const v = Math.max(s, 0);
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}

/**
 * The lineup-draft room (Phase 1). On-clock banner + soft clock, a match
 * board filling side-by-side, and — when it's your team's turn — a tappable
 * roster grid. Snake order and the lead/answer flip come from the shared
 * draft engine. Realtime keeps every phone in sync.
 */
export function LineupDraftRoom({ draft }: { draft: LineupDraftView }) {
  const router = useRouter();
  const [sel, setSel] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const supabase = createClient();
    const debounce = { t: null as ReturnType<typeof setTimeout> | null };
    const refresh = () => {
      if (debounce.t) clearTimeout(debounce.t);
      debounce.t = setTimeout(() => router.refresh(), 300);
    };
    const channel = supabase
      .channel(`lineup-draft-${draft.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lineup_draft_picks" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "lineup_drafts" }, refresh)
      .subscribe();
    return () => {
      if (debounce.t) clearTimeout(debounce.t);
      supabase.removeChannel(channel);
    };
  }, [router, draft.id]);

  // Soft clock ticks locally off the server anchor.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (draft.status !== "live") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [draft.status]);

  // Light reveal: flash the newest pick. Keyed on pick COUNT (primitive) so
  // the interim realtime refreshes don't cancel the dismiss timer.
  const pickCount = draft.picks.length;
  const [reveal, setReveal] = useState<LineupPickView | null>(null);
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (seen.current === null) { seen.current = pickCount; return; }
    if (pickCount > seen.current) {
      seen.current = pickCount;
      setReveal(draft.picks[pickCount - 1]);
      const t = setTimeout(() => setReveal(null), 2000);
      return () => clearTimeout(t);
    }
    seen.current = pickCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickCount]);

  const ordered: [LineupTeam, LineupTeam] =
    draft.firstPickTeamId === draft.homeTeam.id
      ? [draft.homeTeam, draft.awayTeam]
      : [draft.awayTeam, draft.homeTeam];

  const totalPicks = draft.matchups.length * 2;
  const nextPick = pickCount + 1;
  const onClock = ordered[teamIndexForPick(nextPick)];
  const isLead = nextPick % 2 === 1;
  const currentMatchNumber = Math.ceil(nextPick / 2);
  const myTurn = draft.status === "live"
    && (draft.viewerIsAdmin || draft.captainOf === onClock.id)
    && nextPick <= totalPicks;
  const remaining = clockRemaining(draft.currentPickStartedAt, draft.pickSeconds, now);
  const overTime = remaining !== null && remaining < 0;

  const usedIds = new Set(
    draft.matchups.flatMap((m) =>
      [m.home.p1?.id, m.home.p2?.id, m.away.p1?.id, m.away.p2?.id].filter(Boolean) as string[]),
  );
  const pool = (draft.rosters[onClock.id] ?? []).filter((p) => !usedIds.has(p.id));

  const toggle = (id: string) =>
    setSel((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-draft.sideSize));

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const { error } = await makeLineupPick(draft.id, sel);
      if (error) setError(error);
      else setSel([]);
    });
  };

  const undo = () => {
    if (!window.confirm("Take back the last pick?")) return;
    setError(null);
    startTransition(async () => {
      const { error } = await undoLastLineupPick(draft.id);
      if (error) setError(error);
    });
  };

  const teamOf = (id: string) => (id === draft.homeTeam.id ? draft.homeTeam : draft.awayTeam);
  const selNames = sel.map((id) => pool.find((p) => p.id === id)?.name).filter(Boolean).join(" & ");

  const sideCell = (s: { p1: SidePlayer | null; p2: SidePlayer | null }, color: string) => {
    const names = [s.p1, s.p2].filter(Boolean) as SidePlayer[];
    if (names.length === 0) return <span className="text-navy/30">—</span>;
    return (
      <span className="flex items-center gap-1.5">
        {names.map((p) => (
          <Avatar key={p.id} url={p.avatarUrl} name={p.name} color={color} className="h-6 w-6 shrink-0 text-[9px]" />
        ))}
        <span className="truncate font-semibold text-navy">{names.map((p) => p.name).join(" & ")}</span>
      </span>
    );
  };

  return (
    <div className="space-y-5">
      {/* light reveal flash */}
      {reveal && (
        <div className="draft-reveal-bg fixed inset-0 z-[950] flex items-center justify-center px-8"
          style={{ backgroundColor: `${teamOf(reveal.teamId).color}F2` }}>
          <div className="draft-reveal-card text-center">
            <p className="text-sm font-bold uppercase tracking-[0.3em] text-white/70">The pick is in</p>
            <p className="mt-3 font-display text-4xl font-bold text-white">{reveal.names.join(" & ")}</p>
            <p className="mt-2 text-sm font-semibold uppercase tracking-widest text-gold">
              {teamOf(reveal.teamId).name}
            </p>
          </div>
        </div>
      )}

      {/* status banner */}
      {draft.status === "live" && (
        <div className="rounded-2xl p-5 text-center" style={{ backgroundColor: onClock.color }}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/70">
            {isLead ? "On the clock · leads" : "On the clock · answers"}
          </p>
          <p className="mt-1 font-display text-3xl font-bold text-white">{onClock.name}</p>
          <p className="mt-0.5 text-sm text-white/80">
            Match {currentMatchNumber} · Capt. {onClock.captainName ?? "TBD"}
          </p>
          {remaining !== null && (
            <p className={`mt-2 font-mono text-4xl font-bold tabular-nums ${overTime ? "animate-pulse text-off-white" : "text-gold"}`}>
              {fmtClock(remaining)}
            </p>
          )}
          {overTime && <p className="mt-0.5 text-sm font-semibold text-white/90">Taking their sweet time…</p>}
          {myTurn && (
            <p className="mt-3 rounded-full bg-white/15 px-3 py-1.5 text-sm font-bold text-white">
              {draft.captainOf === onClock.id ? "Your pick 👇" : "Commissioner mode: pick on their behalf 👇"}
            </p>
          )}
        </div>
      )}

      {draft.status === "complete" && (
        <div className="rounded-2xl border border-gold bg-parchment p-5 text-center">
          <p className="font-display text-2xl font-bold text-navy">🏁 Lineups Set</p>
          <p className="mt-1 text-sm text-navy/60">
            Round {draft.roundNumber}{draft.roundName ? ` · ${draft.roundName}` : ""} is ready.
          </p>
          <Link href="/matches" className="mt-3 inline-block rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-off-white">
            To the matches →
          </Link>
        </div>
      )}

      {error && <p className="rounded-lg bg-usa-red/10 px-3 py-2 text-sm text-usa-red">{error}</p>}

      {/* the board */}
      <div className="overflow-hidden rounded-xl border border-hairline bg-white">
        <div className="grid grid-cols-2 divide-x divide-hairline">
          {[draft.homeTeam, draft.awayTeam].map((team) => (
            <div key={team.id} className="px-3 py-2 text-white" style={{ backgroundColor: team.color }}>
              <p className="font-display text-sm font-bold leading-tight">{team.name}</p>
              <p className="text-[11px] text-white/70">Capt. {team.captainName ?? "TBD"}</p>
            </div>
          ))}
        </div>
        <ul className="divide-y divide-hairline">
          {draft.matchups.map((m) => {
            const active = draft.status === "live" && m.matchNumber === currentMatchNumber;
            return (
              <li key={m.id} className={active ? "bg-gold/10" : ""}>
                <p className="px-3 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-navy/40">
                  Match {m.matchNumber}
                </p>
                <div className="grid grid-cols-2 divide-x divide-hairline">
                  <div className="min-w-0 px-3 pb-2 text-sm">{sideCell(m.home, draft.homeTeam.color)}</div>
                  <div className="min-w-0 px-3 pb-2 text-sm">{sideCell(m.away, draft.awayTeam.color)}</div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* roster grid — only when it's your turn */}
      {myTurn && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy/50">
            {onClock.name} · pick {draft.sideSize === 1 ? "a player" : "a pairing"} ({pool.length} left)
          </p>
          <div className="grid grid-cols-3 gap-2">
            {pool.map((p) => {
              const on = sel.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition-colors ${
                    on ? "border-transparent" : "border-hairline bg-white active:bg-parchment"
                  }`}
                  style={on ? { backgroundColor: onClock.color } : undefined}
                >
                  <Avatar url={p.avatarUrl} name={p.name} color="#0C2D55" className="h-11 w-11 shrink-0 text-xs ring-1 ring-gold/60" />
                  <span className={`w-full truncate text-center text-xs font-semibold ${on ? "text-white" : "text-navy"}`}>
                    {p.name}
                  </span>
                  <span className={`text-[10px] tabular-nums ${on ? "text-white/80" : "text-navy/40"}`}>
                    {formatHcp(p.index)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* sticky confirm bar */}
      {myTurn && sel.length > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-40 px-4 pb-2">
          <button
            onClick={submit}
            disabled={isPending}
            className="w-full rounded-xl py-3.5 text-base font-bold text-white shadow-xl disabled:opacity-60"
            style={{ backgroundColor: onClock.color }}
          >
            {isPending ? "Locking in…" : `Lock in ${selNames} — Match ${currentMatchNumber}`}
          </button>
        </div>
      )}

      {/* commissioner undo */}
      {draft.viewerIsAdmin && pickCount > 0 && draft.status !== "scheduled" && (
        <div className="flex items-center justify-between rounded-xl border border-hairline bg-parchment px-4 py-3">
          <p className="text-xs text-navy/50">Commissioner</p>
          <button onClick={undo} disabled={isPending} className="text-sm font-semibold text-usa-red disabled:opacity-50">
            ↩ Undo last pick
          </button>
        </div>
      )}
    </div>
  );
}
