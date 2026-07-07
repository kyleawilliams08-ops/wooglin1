"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { makePick, undoLastPick } from "@/lib/draftActions";
import { teamIndexForPick, pickLabel, clockRemaining } from "@/lib/draft";
import { formatHcp } from "@/lib/handicap";

export interface DraftTeam {
  id: string;
  name: string;
  color: string;
  captainName: string | null;
}

export interface DraftPickView {
  id: string;
  pick_number: number;
  team_id: string;
  participant_id: string;
  name: string;
  avatarUrl: string | null;
}

export interface PoolPlayerView {
  participantId: string;
  name: string;
  avatarUrl: string | null;
  index: number | null;
  appearances: number;
  record: string; // "3–1" / "—"
}

export interface DraftView {
  id: string;
  status: "scheduled" | "live" | "complete";
  scheduled_at: string | null;
  pick_seconds: number;
  call_link: string | null;
  current_pick_started_at: string | null;
  eventName: string;
  eventYear: number;
  /** Snake order: [first-pick team, other team] */
  teams: [DraftTeam, DraftTeam];
  picks: DraftPickView[];
  pool: PoolPlayerView[];
  /** Team id the viewer captains, if any */
  captainOf: string | null;
  viewerIsAdmin: boolean;
}

function Monogram({ name, color, className }: { name: string; color: string; className: string }) {
  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <span
      className={`flex items-center justify-center rounded-full font-display font-bold text-off-white ${className}`}
      style={{ backgroundColor: color }}
    >
      {initials}
    </span>
  );
}

function Avatar({ url, name, color, className }: {
  url: string | null; name: string; color: string; className: string;
}) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={name} className={`rounded-full object-cover ${className}`} />
  ) : (
    <Monogram name={name} color={color} className={className} />
  );
}

function fmtClock(seconds: number): string {
  const s = Math.max(seconds, 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The draft room. One component, three moods:
 *  - scheduled: countdown to draft day
 *  - live: on-the-clock banner, soft pick clock, tappable pool, reveal overlay
 *  - complete: the recap board
 * ?tv=1 renders a chrome-free big-screen version for casting.
 */
export function DraftRoom({ draft, tv }: { draft: DraftView; tv: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Realtime: refresh on any draft/pick change so every screen tracks live.
  useEffect(() => {
    const supabase = createClient();
    const debounce = { t: null as ReturnType<typeof setTimeout> | null };
    const refresh = () => {
      if (debounce.t) clearTimeout(debounce.t);
      debounce.t = setTimeout(() => router.refresh(), 300);
    };
    const channel = supabase
      .channel(`draft-${draft.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_picks" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "drafts" }, refresh)
      .subscribe();
    return () => {
      if (debounce.t) clearTimeout(debounce.t);
      supabase.removeChannel(channel);
    };
  }, [router, draft.id]);

  // Soft pick clock — ticks locally off the server-set anchor.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (draft.status !== "live") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [draft.status]);

  // Pick reveal: when the pick count grows while we're watching, celebrate.
  const [reveal, setReveal] = useState<DraftPickView | null>(null);
  const prevCount = useRef<number | null>(null);
  useEffect(() => {
    const count = draft.picks.length;
    if (prevCount.current !== null && count > prevCount.current) {
      const newest = draft.picks[draft.picks.length - 1];
      setReveal(newest);
      const t = setTimeout(() => setReveal(null), tv ? 5000 : 3200);
      prevCount.current = count;
      return () => clearTimeout(t);
    }
    prevCount.current = count;
  }, [draft.picks, tv]);

  const nextPick = draft.picks.length + 1;
  const onClock = draft.teams[teamIndexForPick(nextPick)];
  const myTurn =
    draft.status === "live" && (draft.viewerIsAdmin || draft.captainOf === onClock.id);
  const remaining = clockRemaining(draft.current_pick_started_at, draft.pick_seconds, now);
  const overTime = remaining !== null && remaining < 0;

  const teamOf = (teamId: string) => draft.teams.find((t) => t.id === teamId)!;
  const picksFor = (teamId: string) => draft.picks.filter((p) => p.team_id === teamId);

  const submitPick = (participantId: string) => {
    setError(null);
    startTransition(async () => {
      const { error } = await makePick(draft.id, participantId);
      if (error) setError(error);
      else setSelected(null);
    });
  };

  const undo = () => {
    if (!window.confirm("Take back the last pick?")) return;
    setError(null);
    startTransition(async () => {
      const { error } = await undoLastPick(draft.id);
      if (error) setError(error);
    });
  };

  const selectedPlayer = draft.pool.find((p) => p.participantId === selected) ?? null;

  /* ---------- pick reveal overlay (phone + TV) ---------- */
  const revealOverlay = reveal && (
    <div
      className="draft-reveal-bg fixed inset-0 z-[950] flex items-center justify-center px-8"
      style={{ backgroundColor: `${teamOf(reveal.team_id).color}F2` }}
    >
      <div className="draft-reveal-card flex flex-col items-center text-center">
        <p className="text-sm font-bold uppercase tracking-[0.3em] text-white/70">
          {pickLabel(reveal.pick_number)}
        </p>
        <Avatar
          url={reveal.avatarUrl}
          name={reveal.name}
          color="#0C2D55"
          className={`${tv ? "h-48 w-48 text-6xl" : "h-32 w-32 text-4xl"} mt-5 shrink-0 ring-4 ring-gold shadow-2xl`}
        />
        <p className={`draft-reveal-name mt-5 font-display font-bold text-white ${tv ? "text-7xl" : "text-4xl"}`}>
          {reveal.name}
        </p>
        <p className={`draft-reveal-name mt-2 font-semibold uppercase tracking-widest text-gold ${tv ? "text-2xl" : "text-sm"}`}>
          {teamOf(reveal.team_id).name}
        </p>
      </div>
    </div>
  );

  /* ---------- board (shared) ---------- */
  const board = (
    <div className="grid grid-cols-2 gap-3">
      {draft.teams.map((team) => (
        <div key={team.id} className={`overflow-hidden rounded-xl border ${tv ? "border-white/20" : "border-hairline bg-white"}`}>
          <div className="px-3 py-2 text-white" style={{ backgroundColor: team.color }}>
            <p className={`font-display font-bold leading-tight ${tv ? "text-3xl" : "text-base"}`}>{team.name}</p>
            <p className={`${tv ? "text-base" : "text-[11px]"} text-white/70`}>
              Capt. {team.captainName ?? "TBD"}
              {draft.status !== "complete" && team.id === draft.teams[0].id && " · 1st pick"}
            </p>
          </div>
          <ul className={tv ? "divide-y divide-white/10" : "divide-y divide-hairline"}>
            {picksFor(team.id).map((p) => (
              <li key={p.id} className={`draft-row-in flex items-center gap-2 px-3 ${tv ? "py-2.5" : "py-2"}`}>
                <span className={`${tv ? "text-lg" : "text-[10px]"} w-7 shrink-0 font-bold tabular-nums ${tv ? "text-white/50" : "text-navy/40"}`}>
                  {p.pick_number}
                </span>
                <Avatar url={p.avatarUrl} name={p.name} color={team.color}
                  className={tv ? "h-10 w-10 shrink-0 text-sm" : "h-7 w-7 shrink-0 text-[10px]"} />
                <span className={`truncate font-semibold ${tv ? "text-2xl text-white" : "text-sm text-navy"}`}>
                  {p.name}
                </span>
              </li>
            ))}
            {picksFor(team.id).length === 0 && (
              <li className={`px-3 py-3 ${tv ? "text-lg text-white/40" : "text-xs text-navy/40"}`}>No picks yet</li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );

  /* ---------- TV mode: chrome-free big-screen spectator view ---------- */
  if (tv) {
    return (
      <div className="fixed inset-0 z-[900] overflow-y-auto bg-navy px-10 py-8">
        {revealOverlay}
        <div className="mx-auto max-w-5xl space-y-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Image src="/crest-small.png" alt="" width={72} height={72} />
              <div>
                <h1 className="font-display text-5xl font-bold text-off-white">
                  {draft.eventYear} Wooglin Cup Draft
                </h1>
                <p className="mt-1 text-xl text-hairline/70">{draft.eventName}</p>
              </div>
            </div>
            {draft.status === "live" && (
              <span className="animate-pulse rounded-full bg-gold px-5 py-2 text-xl font-bold uppercase tracking-widest text-navy">
                Live
              </span>
            )}
          </div>

          {draft.status === "live" && (
            <div className="rounded-2xl px-8 py-6 text-center" style={{ backgroundColor: onClock.color }}>
              <p className="text-xl font-semibold uppercase tracking-[0.3em] text-white/70">On the clock</p>
              <p className="mt-2 font-display text-6xl font-bold text-white">{onClock.name}</p>
              <p className="mt-1 text-2xl text-white/80">
                {pickLabel(nextPick)} · Capt. {onClock.captainName ?? "TBD"}
              </p>
              {remaining !== null && (
                <p className={`mt-3 font-mono text-7xl font-bold tabular-nums ${overTime ? "animate-pulse text-usa-red" : "text-gold"}`}>
                  {fmtClock(remaining)}
                </p>
              )}
              {overTime && (
                <p className="mt-1 text-2xl font-semibold text-white/90">Taking their sweet time…</p>
              )}
            </div>
          )}

          {draft.status === "complete" && (
            <div className="rounded-2xl border border-gold bg-gold/10 px-8 py-6 text-center">
              <p className="font-display text-5xl font-bold text-gold">Draft Complete</p>
              <p className="mt-2 text-2xl text-off-white/80">The {draft.eventYear} rosters are set. 🐉</p>
            </div>
          )}

          {board}

          {draft.status === "live" && draft.pool.length > 0 && (
            <p className="text-center text-2xl text-hairline/70">
              {draft.pool.length} player{draft.pool.length === 1 ? "" : "s"} left in the pool
            </p>
          )}
        </div>
      </div>
    );
  }

  /* ---------- phone view ---------- */
  return (
    <div className="space-y-5">
      {revealOverlay}

      {/* status banner */}
      {draft.status === "scheduled" && (
        <div className="rounded-2xl bg-navy p-5 text-center">
          <p className="text-xs uppercase tracking-widest text-hairline/60">Draft Day</p>
          <p className="mt-1 font-display text-2xl font-bold text-off-white">
            {draft.scheduled_at
              ? new Date(draft.scheduled_at).toLocaleDateString("en-US", {
                  weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
                })
              : "Date TBD"}
          </p>
          <p className="mt-2 text-sm text-hairline">
            {draft.pool.length} players in the pool · {draft.teams[0].name} picks first
          </p>
        </div>
      )}

      {draft.status === "live" && (
        <div className="rounded-2xl p-5 text-center" style={{ backgroundColor: onClock.color }}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/70">On the clock</p>
          <p className="mt-1 font-display text-3xl font-bold text-white">{onClock.name}</p>
          <p className="mt-0.5 text-sm text-white/80">
            {pickLabel(nextPick)} · Capt. {onClock.captainName ?? "TBD"}
          </p>
          {remaining !== null && (
            <p className={`mt-2 font-mono text-4xl font-bold tabular-nums ${overTime ? "animate-pulse text-off-white" : "text-gold"}`}>
              {fmtClock(remaining)}
            </p>
          )}
          {overTime && <p className="mt-0.5 text-sm font-semibold text-white/90">Taking their sweet time…</p>}
          {myTurn && (
            <p className="mt-3 rounded-full bg-white/15 px-3 py-1.5 text-sm font-bold text-white">
              {draft.captainOf === onClock.id ? "Your pick — choose below 👇" : "Commissioner mode: pick on their behalf 👇"}
            </p>
          )}
        </div>
      )}

      {draft.status === "complete" && (
        <div className="rounded-2xl border border-gold bg-parchment p-5 text-center">
          <p className="font-display text-2xl font-bold text-navy">🏆 Draft Complete</p>
          <p className="mt-1 text-sm text-navy/60">The {draft.eventYear} rosters are set.</p>
          <Link href="/matches" className="mt-3 inline-block rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-off-white">
            To the matches →
          </Link>
        </div>
      )}

      {/* call link */}
      {draft.call_link && draft.status !== "complete" && (
        <a
          href={draft.call_link}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-2 rounded-xl border border-gold/60 bg-parchment px-4 py-3 text-sm font-bold text-navy"
        >
          📞 Join the draft call
        </a>
      )}

      {error && (
        <p className="rounded-lg bg-usa-red/10 px-3 py-2 text-sm text-usa-red">{error}</p>
      )}

      {/* the board */}
      {board}

      {/* available players */}
      {draft.status !== "complete" && draft.pool.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy/50">
            Available Players ({draft.pool.length})
          </p>
          <div className="grid grid-cols-2 gap-2">
            {draft.pool.map((p) => {
              const isSelected = selected === p.participantId;
              return (
                <button
                  key={p.participantId}
                  type="button"
                  disabled={!myTurn || isPending}
                  onClick={() => setSelected(isSelected ? null : p.participantId)}
                  className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all ${
                    isSelected
                      ? "scale-[1.02] border-gold bg-parchment ring-2 ring-gold"
                      : "border-hairline bg-white"
                  } ${myTurn ? "" : "opacity-90"}`}
                >
                  <Avatar url={p.avatarUrl} name={p.name} color="#0C2D55"
                    className="h-10 w-10 shrink-0 text-xs" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-navy">{p.name}</span>
                    <span className="block text-[11px] tabular-nums text-navy/50">
                      {formatHcp(p.index)} · {p.appearances} cup{p.appearances === 1 ? "" : "s"} · {p.record}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* sticky draft bar when a player is selected */}
      {myTurn && selectedPlayer && (
        <div className="fixed inset-x-0 bottom-16 z-40 px-4 pb-2">
          <button
            onClick={() => submitPick(selectedPlayer.participantId)}
            disabled={isPending}
            className="w-full rounded-xl py-3.5 text-base font-bold text-white shadow-xl disabled:opacity-60"
            style={{ backgroundColor: onClock.color }}
          >
            {isPending ? "Drafting…" : `Draft ${selectedPlayer.name} — ${pickLabel(nextPick)}`}
          </button>
        </div>
      )}

      {/* commissioner controls */}
      {draft.viewerIsAdmin && draft.picks.length > 0 && draft.status !== "scheduled" && (
        <div className="flex items-center justify-between rounded-xl border border-hairline bg-parchment px-4 py-3">
          <p className="text-xs text-navy/50">Commissioner</p>
          <button onClick={undo} disabled={isPending}
            className="text-sm font-semibold text-usa-red disabled:opacity-50">
            ↩ Undo last pick
          </button>
        </div>
      )}

      {/* TV mode hint */}
      <p className="text-center text-xs text-navy/40">
        Casting to a TV? <Link href="/draft?tv=1" className="underline underline-offset-2">Open TV mode</Link>
      </p>
    </div>
  );
}
