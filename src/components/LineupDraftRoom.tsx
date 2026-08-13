"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { makeLineupPick, undoLastLineupPick } from "@/lib/lineupDraftActions";
import { playDraftChime, preloadPickSound, unlockAudio } from "@/lib/chime";
import { teamIndexForPick, clockRemaining } from "@/lib/draft";
import { formatHcp } from "@/lib/handicap";

export interface LineupTeam { id: string; name: string; color: string; captainName: string | null }
export interface SidePlayer {
  id: string;
  name: string;       // nickname (phone)
  fullName: string;   // full name (TV)
  avatarUrl: string | null;
  record: string;     // this event's W–L(–T), e.g. "2–0"
}
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
  fullNames: string[];
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
  homeScore: number;
  awayScore: number;
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

function fmtPts(n: number): string {
  if (n % 1 === 0.5) return n < 1 ? "½" : `${Math.floor(n)}½`;
  return String(n);
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

  // Polling fallback for flaky cross-device realtime (see DraftRoom).
  useEffect(() => {
    if (draft.status !== "live") return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [router, draft.status]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (draft.status !== "live") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [draft.status]);

  // Draft-night sound (see DraftRoom): unlock on first interaction.
  const [soundOn, setSoundOn] = useState(true);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  useEffect(() => {
    preloadPickSound();
    const unlock = async () => {
      if (await unlockAudio()) setAudioUnlocked(true);
    };
    void unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const soundButton = (big: boolean) => (
    <button
      type="button"
      onClick={async () => {
        const ok = await unlockAudio();
        setAudioUnlocked(ok);
        const next = !soundOn;
        setSoundOn(next);
        if (next && ok) playDraftChime(0.7);
      }}
      aria-label={soundOn ? "Mute draft sounds" : "Unmute draft sounds"}
      className={
        big
          ? `rounded-full border px-4 py-2 text-base font-semibold ${
              soundOn && audioUnlocked ? "border-gold/60 text-gold" : "border-white/30 text-white/60 hover:bg-white/10 hover:text-white"
            }`
          : `rounded-full border px-3 py-1 text-xs font-semibold ${
              soundOn && audioUnlocked ? "border-gold bg-gold/20 text-navy" : "border-hairline text-navy/50"
            }`
      }
    >
      {soundOn ? (audioUnlocked ? "🔊 Sound on" : "🔇 Tap to enable sound") : "🔇 Sound off"}
    </button>
  );

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
    const label = (p: SidePlayer) => (tv ? p.fullName : p.name);
    let fight: FightData | null = null;
    if (m && m.home.p1 && m.away.p1) {
      const s = m.strokes;
      const homeStrokes = s ? (s.oneScore ? [s.homeTeam] : [s.home.p1, s.home.p2]) : [];
      const awayStrokes = s ? (s.oneScore ? [s.awayTeam] : [s.away.p1, s.away.p2]) : [];
      const homePlayers = [m.home.p1, m.home.p2].filter(Boolean).map((p, i) => ({
        name: label(p as SidePlayer), strokes: s?.oneScore ? null : (homeStrokes[i] ?? null),
      }));
      const awayPlayers = [m.away.p1, m.away.p2].filter(Boolean).map((p, i) => ({
        name: label(p as SidePlayer), strokes: s?.oneScore ? null : (awayStrokes[i] ?? null),
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
    return { teamName: team.name, teamColor: team.color, names: tv ? pick.fullNames : pick.names, fight };
  };

  useEffect(() => {
    if (seen.current === null) { seen.current = pickCount; return; }
    if (pickCount <= seen.current) { seen.current = pickCount; return; }
    seen.current = pickCount;

    const data = buildReveal(draft.picks[pickCount - 1]);
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (soundOn) playDraftChime();   // fanfare under "THE PICK IS IN"
    setReveal(data);
    setPhase("pickin");
    // "THE PICK IS IN" holds for the chime's length so names land as it ends.
    const pickinMs = soundOn ? 5300 : 2400;
    const revealMs = 2400, fightMs = tv ? 5200 : 3800;
    timers.current.push(setTimeout(() => setPhase("reveal"), pickinMs));
    if (data.fight) {
      timers.current.push(setTimeout(() => setPhase("fight"), pickinMs + revealMs));
      timers.current.push(setTimeout(() => { setPhase(null); setReveal(null); }, pickinMs + revealMs + fightMs));
    } else {
      timers.current.push(setTimeout(() => { setPhase(null); setReveal(null); }, pickinMs + revealMs));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickCount, tv, soundOn]);

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

  // ── The board ───────────────────────────────────────────────────────────
  // Each card STACKS its two sides (home over away) so names get the full card
  // width — no more truncation. Rows show photo, name (full on TV), record,
  // and the strokes that ball gets (the handicap allowance for the match).
  const strokeArr = (m: LineupMatchupView, sideKey: "home" | "away"): (number | null)[] => {
    const s = m.strokes;
    if (!s || s.oneScore) return [];
    return sideKey === "home" ? [s.home.p1, s.home.p2] : [s.away.p1, s.away.p2];
  };
  const teamStroke = (m: LineupMatchupView, sideKey: "home" | "away"): number | null => {
    const s = m.strokes;
    if (!s || !s.oneScore) return null;
    return sideKey === "home" ? s.homeTeam : s.awayTeam;
  };

  const sideBlock = (
    s: { p1: SidePlayer | null; p2: SidePlayer | null },
    t: LineupTeam,
    strokes: (number | null)[],
    tStroke: number | null,
  ) => {
    const players = [s.p1, s.p2].filter(Boolean) as SidePlayer[];
    if (players.length === 0) {
      return (
        <div className={`flex items-center justify-center rounded-lg border border-dashed ${
          tv ? "border-white/15 py-3" : "border-hairline py-2.5"
        }`}>
          <span className={tv ? "text-lg text-white/25" : "text-xs text-navy/25"}>on the clock…</span>
        </div>
      );
    }
    return (
      <div className={`rounded-lg ${tv ? "p-2.5" : "p-2"} space-y-1`} style={{ backgroundColor: t.color }}>
        {tStroke != null && tStroke > 0 && (
          <p className={`font-bold uppercase tracking-wide text-white/85 ${tv ? "text-sm" : "text-[10px]"}`}>
            Team gets +{tStroke}
          </p>
        )}
        {players.map((p, i) => {
          const st = strokes[i];
          return (
            <div key={p.id} className="flex items-center gap-2.5">
              <Avatar url={p.avatarUrl} name={p.name} color="#0C2D55"
                className={`${tv ? "h-9 w-9 text-xs" : "h-6 w-6 text-[9px]"} shrink-0 ring-1 ring-gold/70`} />
              <div className="min-w-0 flex-1">
                <p className={`truncate font-semibold leading-tight text-white ${tv ? "text-xl" : "text-xs"}`}>
                  {tv ? p.fullName : p.name}
                </p>
                <p className={`tabular-nums text-white/65 ${tv ? "text-xs" : "text-[9px]"}`}>{p.record}</p>
              </div>
              {st != null && st > 0 && (
                <span className={`shrink-0 rounded-full bg-gold font-bold tabular-nums text-navy ${
                  tv ? "px-2 py-0.5 text-sm" : "px-1.5 py-0.5 text-[9px]"
                }`}>
                  +{st}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const board = (
    <div className={tv ? "grid grid-cols-2 gap-4" : "space-y-3"}>
      {draft.matchups.map((m) => {
        const bothIn = !!(m.home.p1 && m.away.p1);
        const active = draft.status === "live" && m.matchNumber === currentMatchNumber;
        return (
          <div key={m.id}
            className={`draft-row-in overflow-hidden rounded-xl ${
              tv ? "bg-off-white shadow-lg" : "border border-hairline bg-white"
            } ${active && !bothIn ? "ring-2 ring-gold" : ""}`}>
            <div className="flex items-center justify-between px-3 pt-2">
              <p className={`font-semibold uppercase tracking-wide ${tv ? "text-sm text-navy/50" : "text-[10px] text-navy/40"}`}>
                Match {m.matchNumber}
              </p>
              {bothIn && (
                <p className={`font-bold uppercase tracking-wide text-gold ${tv ? "text-sm" : "text-[9px]"}`}>Set</p>
              )}
            </div>
            <div className={`space-y-1.5 p-2 ${tv ? "" : ""}`}>
              {sideBlock(m.home, draft.homeTeam, strokeArr(m, "home"), teamStroke(m, "home"))}
              <p className={`text-center font-display font-bold ${tv ? "text-lg text-navy/35" : "text-xs text-navy/30"}`}>vs</p>
              {sideBlock(m.away, draft.awayTeam, strokeArr(m, "away"), teamStroke(m, "away"))}
            </div>
          </div>
        );
      })}
    </div>
  );

  // Event scoreboard — team points so far this cup.
  const showScore = draft.homeScore + draft.awayScore > 0;
  const scoreboard = showScore && (
    <div className={tv
      ? "rounded-2xl border border-white/10 bg-white/5 px-5 py-4"
      : "rounded-xl border border-hairline bg-white px-4 py-3"}>
      <p className={`mb-1 text-center font-semibold uppercase tracking-wide ${tv ? "text-sm text-white/45" : "text-[10px] text-navy/40"}`}>
        Event Score
      </p>
      <div className="flex items-center justify-center gap-4">
        {[draft.homeTeam, draft.awayTeam].map((team, i) => (
          <div key={team.id} className="flex items-center gap-2">
            {i === 1 && <span className={tv ? "text-white/30" : "text-navy/30"}>·</span>}
            <span className={`inline-block rounded-full ${tv ? "h-3 w-3" : "h-2.5 w-2.5"}`} style={{ backgroundColor: team.color }} />
            <span className={`font-bold tabular-nums ${tv ? "text-3xl text-off-white" : "text-2xl text-navy"}`}>
              {fmtPts(i === 0 ? draft.homeScore : draft.awayScore)}
            </span>
            <span className={`font-semibold ${tv ? "text-base text-white/60" : "text-xs text-navy/50"}`}>{team.name}</span>
          </div>
        ))}
      </div>
    </div>
  );

  // Bench tracker: who each captain is still holding.
  const benchCard = (
    <div className={tv
      ? "rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3"
      : "rounded-xl border border-hairline bg-parchment px-4 py-3 space-y-2"}>
      {[draft.homeTeam, draft.awayTeam].map((team) => {
        const bench = benchOf(team.id);
        return (
          <div key={team.id}>
            <p className={`mb-1 flex items-center gap-1.5 font-semibold uppercase tracking-wide ${
              tv ? "text-sm text-white/50" : "text-[10px] text-navy/40"
            }`}>
              <span className={`inline-block rounded-full ${tv ? "h-2.5 w-2.5" : "h-2 w-2"}`}
                style={{ backgroundColor: team.color }} />
              {team.name} bench
            </p>
            {bench.length === 0 ? (
              <p className={tv ? "text-base text-white/35" : "text-[11px] text-navy/35"}>Everyone&rsquo;s in.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {bench.map((p) => (
                  <span key={p.id} className={`flex items-center gap-1.5 rounded-full ${
                    tv ? "bg-white/10 px-2.5 py-1 text-base text-white/80" : "bg-white px-2 py-0.5 text-[11px] text-navy/70 border border-hairline"
                  }`}>
                    <Avatar url={p.avatarUrl} name={p.name} color={team.color}
                      className={`${tv ? "h-6 w-6 text-[9px]" : "h-4 w-4 text-[7px]"} shrink-0`} />
                    {p.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  // ── TV mode ─────────────────────────────────────────────────────────────
  if (tv) {
    return (
      <div className="fixed inset-0 z-[900] overflow-y-auto bg-navy px-10 py-8">
        {overlay}
        <div className="mx-auto max-w-6xl space-y-7">
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
              {soundButton(true)}
              <Link href={`/matches/lineup-draft/${draft.roundId}`}
                className="rounded-full border border-white/30 px-4 py-2 text-base font-semibold text-white/60 hover:bg-white/10 hover:text-white">
                ✕ Exit TV
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-[minmax(300px,380px)_minmax(0,1fr)] items-start gap-6">
            {/* left rail: on the clock + benches */}
            <div className="space-y-5">
              {draft.status === "live" && nextPick <= totalPicks && (
                <div className="rounded-2xl px-6 py-8 text-center shadow-xl" style={{ backgroundColor: onClock.color }}>
                  <p className="text-base font-semibold uppercase tracking-[0.3em] text-white/70">
                    {isLead ? "On the clock · leads" : "On the clock · answers"}
                  </p>
                  <p className="mt-2 font-display text-6xl font-bold text-white">{onClock.name}</p>
                  <p className="mt-2 text-xl text-white/80">
                    Match {currentMatchNumber} · Capt. {onClock.captainName ?? "TBD"}
                  </p>
                  {remaining !== null && (
                    <p className={`mt-4 font-mono text-8xl font-bold tabular-nums ${overTime ? "animate-pulse text-off-white" : "text-gold"}`}>
                      {fmtClock(remaining)}
                    </p>
                  )}
                  {overTime && <p className="mt-1 text-xl font-semibold text-white/90">Taking their sweet time…</p>}
                </div>
              )}
              {draft.status === "complete" && (
                <div className="rounded-2xl bg-gold px-6 py-8 text-center shadow-xl">
                  <p className="font-display text-5xl font-bold text-navy">Lineups Set</p>
                  <p className="mt-2 text-xl text-navy/70">Round {draft.roundNumber} is ready. 🐉</p>
                </div>
              )}
              {scoreboard}
              {benchCard}
            </div>

            {/* right: the board */}
            {board}
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

      {scoreboard}

      {board}

      {draft.status !== "complete" && benchCard}

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

      <div className="flex flex-col items-center gap-2">
        {soundButton(false)}
        <p className="text-center text-xs text-navy/40">
          Casting to a TV? <Link href={`/matches/lineup-draft/${draft.roundId}?tv=1`} className="underline underline-offset-2">Open TV mode</Link>
        </p>
      </div>
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
