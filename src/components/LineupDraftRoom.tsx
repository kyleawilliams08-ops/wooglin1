"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { makeLineupPick, undoLastLineupPick } from "@/lib/lineupDraftActions";
import { teamIndexForPick, clockRemaining } from "@/lib/draft";
import { formatHcp } from "@/lib/handicap";

export interface LineupTeam { id: string; name: string; color: string; captainName: string | null }
export interface SidePlayer { id: string; name: string; avatarUrl: string | null }
export interface StrokesInfo {
  oneScore: boolean;
  home: { p1: number; p2: number | null };
  away: { p1: number; p2: number | null };
  homeTeam: number | null;
  awayTeam: number | null;
}
export interface LineupMatchupView {
  id: string;
  matchNumber: number;
  home: { p1: SidePlayer | null; p2: SidePlayer | null };
  away: { p1: SidePlayer | null; p2: SidePlayer | null };
  strokes: StrokesInfo | null;
}
export interface RosterPlayer { id: string; name: string; avatarUrl: string | null; index: number | null }
export interface LineupPickView {
  pickNumber: number;
  teamId: string;
  matchupId: string;
  side: "home" | "away";
  names: string[];
}

export interface LineupDraftView {
  id: string;
  roundId: string;
  status: "scheduled" | "live" | "complete";
  roundNumber: number;
  roundName: string | null;
  eventName: string;
  sideSize: 1 | 2;
  pickSeconds: number;
  currentPickStartedAt: string | null;
  homeTeam: LineupTeam;
  awayTeam: LineupTeam;
  firstPickTeamId: string;
  matchups: LineupMatchupView[];
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

interface FightData {
  matchNumber: number;
  homeName: string; awayName: string;
  homeColor: string; awayColor: string;
  homePlayers: { name: string; strokes: number | null }[];
  awayPlayers: { name: string; strokes: number | null }[];
  headline: string;
}
interface RevealData {
  teamName: string; teamColor: string;
  names: string[];
  fight: FightData | null;
}
type Phase = "pickin" | "reveal" | "fight" | null;

/**
 * The lineup-draft room (Phase 2). Phone view for captains + a chrome-free
 * ?tv=1 casting view. Every pick plays "THE PICK IS IN" → staggered name
 * reveal → and, when a match's two sides are both in, a fight-card clash
 * with the strokes each side is getting. Fly-to-corner board + bench tracker.
 */
export function LineupDraftRoom({ draft, tv }: { draft: LineupDraftView; tv: boolean }) {
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

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (draft.status !== "live") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [draft.status]);

  const ordered: [LineupTeam, LineupTeam] =
    draft.firstPickTeamId === draft.homeTeam.id
      ? [draft.homeTeam, draft.awayTeam]
      : [draft.awayTeam, draft.homeTeam];
  const teamOf = (id: string) => (id === draft.homeTeam.id ? draft.homeTeam : draft.awayTeam);

  // ── Reveal state machine, keyed on pick COUNT (primitive so interim
  // realtime refreshes don't restart the timeline) ────────────────────────
  const pickCount = draft.picks.length;
  const [phase, setPhase] = useState<Phase>(null);
  const [reveal, setReveal] = useState<RevealData | null>(null);
  const seen = useRef<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const buildReveal = (pick: LineupPickView): RevealData => {
    const team = teamOf(pick.teamId);
    const m = draft.matchups.find((x) => x.id === pick.matchupId);
    let fight: FightData | null = null;
    if (m && m.home.p1 && m.away.p1) {
      const s = m.strokes;
      const homeStrokes = s ? (s.oneScore ? [s.homeTeam] : [s.home.p1, s.home.p2]) : [];
      const awayStrokes = s ? (s.oneScore ? [s.awayTeam] : [s.away.p1, s.away.p2]) : [];
      const homePlayers = [m.home.p1, m.home.p2].filter(Boolean).map((p, i) => ({
        name: (p as SidePlayer).name, strokes: s?.oneScore ? null : (homeStrokes[i] ?? null),
      }));
      const awayPlayers = [m.away.p1, m.away.p2].filter(Boolean).map((p, i) => ({
        name: (p as SidePlayer).name, strokes: s?.oneScore ? null : (awayStrokes[i] ?? null),
      }));
      fight = {
        matchNumber: m.matchNumber,
        homeName: draft.homeTeam.name, awayName: draft.awayTeam.name,
        homeColor: draft.homeTeam.color, awayColor: draft.awayTeam.color,
        homePlayers, awayPlayers,
        headline: strokesHeadline(s, draft.homeTeam.name, draft.awayTeam.name,
          [...homePlayers, ...awayPlayers]),
      };
    }
    return { teamName: team.name, teamColor: team.color, names: pick.names, fight };
  };

  useEffect(() => {
    if (seen.current === null) { seen.current = pickCount; return; }
    if (pickCount <= seen.current) { seen.current = pickCount; return; }
    seen.current = pickCount;

    const data = buildReveal(draft.picks[pickCount - 1]);
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setReveal(data);
    setPhase("pickin");
    const pickinMs = 2400, revealMs = 2400, fightMs = tv ? 5200 : 3800;
    timers.current.push(setTimeout(() => setPhase("reveal"), pickinMs));
    if (data.fight) {
      timers.current.push(setTimeout(() => setPhase("fight"), pickinMs + revealMs));
      timers.current.push(setTimeout(() => { setPhase(null); setReveal(null); }, pickinMs + revealMs + fightMs));
    } else {
      timers.current.push(setTimeout(() => { setPhase(null); setReveal(null); }, pickinMs + revealMs));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickCount, tv]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // ── Turn / pool state ───────────────────────────────────────────────────
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
  const benchOf = (teamId: string) => (draft.rosters[teamId] ?? []).filter((p) => !usedIds.has(p.id));
  const pool = benchOf(onClock.id);

  const toggle = (id: string) =>
    setSel((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-draft.sideSize));
  const submit = () => {
    setError(null);
    startTransition(async () => {
      const { error } = await makeLineupPick(draft.id, sel);
      if (error) setError(error); else setSel([]);
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
  const selNames = sel.map((id) => pool.find((p) => p.id === id)?.name).filter(Boolean).join(" & ");

  // ── Reveal overlay (shared by phone + TV) ───────────────────────────────
  const overlay = reveal && phase && (
    <div className="draft-reveal-bg fixed inset-0 z-[950] flex items-center justify-center px-8"
      style={{ backgroundColor: phase === "fight" ? "#0C2D55F7" : `${reveal.teamColor}F2` }}>
      {phase === "pickin" && (
        <div className="draft-reveal-card text-center">
          <p className={`font-bold uppercase tracking-[0.4em] text-white/80 ${tv ? "text-3xl" : "text-lg"}`}>
            The pick is in
          </p>
          <p className={`mt-4 font-display font-bold uppercase tracking-widest text-gold ${tv ? "text-6xl" : "text-3xl"}`}>
            {reveal.teamName}
          </p>
        </div>
      )}
      {phase === "reveal" && (
        <div className="text-center">
          <div className="flex items-center justify-center gap-6">
            {reveal.names.map((n, i) => (
              <p key={n} className="draft-reveal-name font-display font-bold text-white"
                style={{ animationDelay: `${i * 700}ms`, fontSize: tv ? "5rem" : "2.75rem" }}>
                {n}
              </p>
            ))}
          </div>
          <p className="draft-reveal-name mt-4 font-semibold uppercase tracking-[0.3em] text-gold"
            style={{ animationDelay: `${reveal.names.length * 700 + 200}ms`, fontSize: tv ? "1.75rem" : "0.95rem" }}>
            {reveal.teamName}
          </p>
        </div>
      )}
      {phase === "fight" && reveal.fight && <FightCard fight={reveal.fight} tv={tv} />}
    </div>
  );

  // ── The board (fly-to-corner grid) ──────────────────────────────────────
  const board = (
    <div className={`grid gap-3 ${draft.matchups.length > 4 ? "grid-cols-2" : draft.matchups.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
      {draft.matchups.map((m) => {
        const bothIn = !!(m.home.p1 && m.away.p1);
        const active = draft.status === "live" && m.matchNumber === currentMatchNumber;
        const nameStr = (s: { p1: SidePlayer | null; p2: SidePlayer | null }) =>
          [s.p1?.name, s.p2?.name].filter(Boolean).join(" & ");
        return (
          <div key={m.id}
            className={`draft-row-in overflow-hidden rounded-xl border ${
              tv ? "border-white/15" : "border-hairline bg-white"
            } ${active && !bothIn ? "ring-2 ring-gold" : ""}`}>
            <p className={`px-3 pt-2 font-semibold uppercase tracking-wide ${tv ? "text-sm text-white/50" : "text-[10px] text-navy/40"}`}>
              Match {m.matchNumber}
            </p>
            <div className="grid grid-cols-2 gap-px p-2">
              {[{ s: m.home, t: draft.homeTeam }, { s: m.away, t: draft.awayTeam }].map(({ s, t }, i) => (
                <div key={i} className="rounded-lg px-2 py-1.5"
                  style={s.p1 ? { backgroundColor: t.color } : undefined}>
                  <p className={`truncate font-semibold ${
                    s.p1 ? "text-white" : tv ? "text-white/30" : "text-navy/30"
                  } ${tv ? "text-lg" : "text-xs"}`}>
                    {s.p1 ? nameStr(s) : "—"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  const benchStrip = (team: LineupTeam) => {
    const bench = benchOf(team.id);
    if (bench.length === 0) return null;
    return (
      <div className={tv ? "text-base" : "text-[11px]"}>
        <span className={tv ? "text-white/50" : "text-navy/40"}>{team.name} bench: </span>
        <span className={tv ? "text-white/70" : "text-navy/55"}>
          {bench.map((p) => p.name).join(" · ")}
        </span>
      </div>
    );
  };

  // ── TV mode ─────────────────────────────────────────────────────────────
  if (tv) {
    return (
      <div className="fixed inset-0 z-[900] overflow-y-auto bg-navy px-10 py-8">
        {overlay}
        <div className="mx-auto max-w-5xl space-y-7">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Image src="/crest-small.png" alt="" width={64} height={64} />
              <div>
                <h1 className="font-display text-4xl font-bold text-off-white">
                  {draft.eventName} · Lineup Draft
                </h1>
                <p className="text-xl text-hairline/70">
                  Round {draft.roundNumber}{draft.roundName ? ` · ${draft.roundName}` : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {draft.status === "live" && (
                <span className="animate-pulse rounded-full bg-gold px-5 py-2 text-xl font-bold uppercase tracking-widest text-navy">Live</span>
              )}
              <Link href={`/matches/lineup-draft/${draft.roundId}`}
                className="rounded-full border border-white/30 px-4 py-2 text-base font-semibold text-white/60 hover:bg-white/10 hover:text-white">
                ✕ Exit TV
              </Link>
            </div>
          </div>

          {draft.status === "live" && nextPick <= totalPicks && (
            <div className="rounded-2xl px-8 py-5 text-center" style={{ backgroundColor: onClock.color }}>
              <p className="text-lg font-semibold uppercase tracking-[0.3em] text-white/70">
                {isLead ? "On the clock · leads" : "On the clock · answers"}
              </p>
              <p className="mt-1 font-display text-5xl font-bold text-white">{onClock.name}</p>
              <p className="mt-1 text-xl text-white/80">Match {currentMatchNumber} · Capt. {onClock.captainName ?? "TBD"}</p>
              {remaining !== null && (
                <p className={`mt-2 font-mono text-6xl font-bold tabular-nums ${overTime ? "animate-pulse text-usa-red" : "text-gold"}`}>
                  {fmtClock(remaining)}
                </p>
              )}
            </div>
          )}
          {draft.status === "complete" && (
            <div className="rounded-2xl border border-gold bg-gold/10 px-8 py-5 text-center">
              <p className="font-display text-4xl font-bold text-gold">Lineups Set</p>
              <p className="mt-1 text-xl text-off-white/80">
                Round {draft.roundNumber} is ready. 🐉
              </p>
            </div>
          )}

          {board}

          <div className="space-y-1">
            {benchStrip(draft.homeTeam)}
            {benchStrip(draft.awayTeam)}
          </div>
        </div>
      </div>
    );
  }

  // ── Phone view ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {overlay}

      {draft.status === "live" && nextPick <= totalPicks && (
        <div className="rounded-2xl p-5 text-center" style={{ backgroundColor: onClock.color }}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/70">
            {isLead ? "On the clock · leads" : "On the clock · answers"}
          </p>
          <p className="mt-1 font-display text-3xl font-bold text-white">{onClock.name}</p>
          <p className="mt-0.5 text-sm text-white/80">Match {currentMatchNumber} · Capt. {onClock.captainName ?? "TBD"}</p>
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

      {board}

      {(benchOf(draft.homeTeam.id).length > 0 || benchOf(draft.awayTeam.id).length > 0) && draft.status !== "complete" && (
        <div className="space-y-1 rounded-xl border border-hairline bg-parchment px-4 py-3">
          {benchStrip(draft.homeTeam)}
          {benchStrip(draft.awayTeam)}
        </div>
      )}

      {myTurn && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy/50">
            {onClock.name} · pick {draft.sideSize === 1 ? "a player" : "a pairing"} ({pool.length} left)
          </p>
          <div className="grid grid-cols-3 gap-2">
            {pool.map((p) => {
              const on = sel.includes(p.id);
              return (
                <button key={p.id} type="button" onClick={() => toggle(p.id)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition-colors ${
                    on ? "border-transparent" : "border-hairline bg-white active:bg-parchment"
                  }`}
                  style={on ? { backgroundColor: onClock.color } : undefined}>
                  <Avatar url={p.avatarUrl} name={p.name} color="#0C2D55" className="h-11 w-11 shrink-0 text-xs ring-1 ring-gold/60" />
                  <span className={`w-full truncate text-center text-xs font-semibold ${on ? "text-white" : "text-navy"}`}>{p.name}</span>
                  <span className={`text-[10px] tabular-nums ${on ? "text-white/80" : "text-navy/40"}`}>{formatHcp(p.index)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {myTurn && sel.length > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-40 px-4 pb-2">
          <button onClick={submit} disabled={isPending}
            className="w-full rounded-xl py-3.5 text-base font-bold text-white shadow-xl disabled:opacity-60"
            style={{ backgroundColor: onClock.color }}>
            {isPending ? "Locking in…" : `Lock in ${selNames} — Match ${currentMatchNumber}`}
          </button>
        </div>
      )}

      {draft.viewerIsAdmin && pickCount > 0 && draft.status !== "scheduled" && (
        <div className="flex items-center justify-between rounded-xl border border-hairline bg-parchment px-4 py-3">
          <p className="text-xs text-navy/50">Commissioner</p>
          <button onClick={undo} disabled={isPending} className="text-sm font-semibold text-usa-red disabled:opacity-50">
            ↩ Undo last pick
          </button>
        </div>
      )}

      <p className="text-center text-xs text-navy/40">
        Casting to a TV? <Link href={`/matches/lineup-draft/${draft.roundId}?tv=1`} className="underline underline-offset-2">Open TV mode</Link>
      </p>
    </div>
  );
}

function FightCard({ fight, tv }: { fight: FightData; tv: boolean }) {
  const sideCol = (name: string, color: string, players: { name: string; strokes: number | null }[], align: "left" | "right") => (
    <div className={`flex-1 rounded-2xl p-5 ${align === "right" ? "text-right" : "text-left"}`} style={{ backgroundColor: color }}>
      <p className={`font-semibold uppercase tracking-widest text-white/70 ${tv ? "text-lg" : "text-xs"}`}>{name}</p>
      {players.map((p) => (
        <p key={p.name} className={`mt-1 font-display font-bold text-white ${tv ? "text-4xl" : "text-2xl"}`}>
          {p.name}
          {p.strokes != null && p.strokes > 0 && (
            <span className={`ml-2 rounded-full bg-gold px-2 py-0.5 align-middle font-sans font-bold text-navy ${tv ? "text-xl" : "text-xs"}`}>
              +{p.strokes}
            </span>
          )}
        </p>
      ))}
    </div>
  );
  return (
    <div className="draft-reveal-card w-full max-w-4xl">
      <p className={`mb-3 text-center font-bold uppercase tracking-[0.4em] text-gold ${tv ? "text-2xl" : "text-sm"}`}>
        Match {fight.matchNumber}
      </p>
      <div className="flex items-stretch gap-3">
        {sideCol(fight.homeName, fight.homeColor, fight.homePlayers, "left")}
        <div className="flex items-center font-display font-bold text-gold" style={{ fontSize: tv ? "3rem" : "1.5rem" }}>vs</div>
        {sideCol(fight.awayName, fight.awayColor, fight.awayPlayers, "right")}
      </div>
      <p className={`mt-3 text-center font-semibold text-off-white/90 ${tv ? "text-2xl" : "text-sm"}`}>{fight.headline}</p>
    </div>
  );
}

/** "Europe gets 3 strokes" / "Boynton gets the shots (+4)" / "Straight up". */
function strokesHeadline(
  s: StrokesInfo | null,
  homeName: string,
  awayName: string,
  players: { name: string; strokes: number | null }[],
): string {
  if (!s) return "";
  if (s.oneScore) {
    const h = s.homeTeam ?? 0, a = s.awayTeam ?? 0;
    if (h === 0 && a === 0) return "Straight up — no strokes";
    return h > a ? `${homeName} gets ${h} stroke${h === 1 ? "" : "s"}` : `${awayName} gets ${a} stroke${a === 1 ? "" : "s"}`;
  }
  const top = players.filter((p) => (p.strokes ?? 0) > 0).sort((a, b) => (b.strokes ?? 0) - (a.strokes ?? 0))[0];
  if (!top) return "Straight up — no strokes";
  return `${top.name} gets the shots (+${top.strokes})`;
}
