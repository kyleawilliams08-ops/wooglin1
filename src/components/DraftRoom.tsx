"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { makePick, undoLastPick, startPlayerDraft } from "@/lib/draftActions";
import { playDraftChime, playDraftTheme, preloadPickSound, unlockAudio } from "@/lib/chime";
import { YouTubePlayer } from "@/components/YouTubePlayer";
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
export function DraftRoom({
  draft,
  tv,
  musicId,
  clipId,
}: {
  draft: DraftView;
  tv: boolean;
  /** Pre-draft hype track — small, bottom-left (TV view only) */
  musicId?: string | null;
  /** Between-picks clip — bigger, bottom-right, toggled on demand (TV only) */
  clipId?: string | null;
}) {
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

  // Polling fallback: postgres_changes realtime can be flaky across devices
  // (and needs the tables in the publication), so while the draft is live we
  // also re-pull every few seconds. Cheap for a room of ~20, and guarantees
  // every phone converges even if a realtime event is dropped.
  useEffect(() => {
    if (draft.status !== "live") return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [router, draft.status]);

  // Draft-night sound. Browsers block audio until a gesture, so unlock on the
  // first interaction anywhere on the page (someone always taps to get here).
  const [soundOn, setSoundOn] = useState(true);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [showMusic, setShowMusic] = useState(true);
  const [musicCovered, setMusicCovered] = useState(false);
  const [showClip, setShowClip] = useState(false);
  const [clipCovered, setClipCovered] = useState(false);
  useEffect(() => {
    preloadPickSound();   // fetch the chime up front so pick 1 doesn't lag
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

  // Theme song: fires once when the draft flips to live (not when you open a
  // draft that's already running), and on demand from the Theme button.
  const stopTheme = useRef<(() => void) | null>(null);
  const prevStatus = useRef<string | null>(null);
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = draft.status;
    if (was && was !== "live" && draft.status === "live") {
      setMusicCovered(true);   // hype is pre-draft — hide it (⏹ Stop kills audio)
      if (soundOn) {
        stopTheme.current?.();
        stopTheme.current = playDraftTheme();
      }
    }
  }, [draft.status, soundOn]);
  useEffect(() => () => stopTheme.current?.(), []);

  // Soft pick clock — ticks locally off the server-set anchor.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (draft.status !== "live") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [draft.status]);

  // Pick reveal: when a new pick lands while we're watching, celebrate.
  // Keyed on the pick COUNT (a primitive) — not the picks array, whose
  // reference changes on every router.refresh(). A single pick fires several
  // realtime refreshes (the draft_picks insert + the drafts clock update);
  // depending on the array would re-run this effect on each one and its
  // cleanup would cancel the dismiss timer, freezing the overlay on. The
  // count only moves on a real pick, so the timer survives the extra
  // refreshes. Baselining on mount avoids replaying picks already on the
  // board; undo/reset lower the count, so the next pick reveals fresh.
  const pickCount = draft.picks.length;
  const [reveal, setReveal] = useState<DraftPickView | null>(null);
  const [revealPhase, setRevealPhase] = useState<"pickin" | "name">("pickin");
  const seenCount = useRef<number | null>(null);
  const revealTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    if (seenCount.current === null) {
      seenCount.current = pickCount; // first render — baseline, don't replay
      return;
    }
    if (pickCount > seenCount.current) {
      seenCount.current = pickCount;
      if (soundOn) playDraftChime();

      // "THE PICK IS IN" holds for the length of the chime (5.33s), then the
      // name drops as it finishes — NFL-draft cadence.
      const PICKIN_MS = soundOn ? 5300 : 1800;
      const NAME_MS = tv ? 5000 : 3600;

      revealTimers.current.forEach(clearTimeout);
      revealTimers.current = [];
      setReveal(draft.picks[pickCount - 1]);
      setRevealPhase("pickin");
      revealTimers.current.push(setTimeout(() => setRevealPhase("name"), PICKIN_MS));
      revealTimers.current.push(setTimeout(() => setReveal(null), PICKIN_MS + NAME_MS));
      return;
    }
    seenCount.current = pickCount;
    // draft.picks[pickCount-1] read intentionally; pickCount gates it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickCount, tv, soundOn]);

  useEffect(() => () => revealTimers.current.forEach(clearTimeout), []);

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

  const start = () => {
    setError(null);
    startTransition(async () => {
      const { error } = await startPlayerDraft(draft.id);
      if (error) setError(error);
    });
  };

  const selectedPlayer = draft.pool.find((p) => p.participantId === selected) ?? null;

  // Tap to mute/unmute; also doubles as the "enable sound" affordance when the
  // browser hasn't handed us audio yet.
  const soundButton = (big: boolean) => (
    <button
      type="button"
      onClick={async () => {
        const ok = await unlockAudio();
        setAudioUnlocked(ok);
        const next = !soundOn;
        setSoundOn(next);
        if (next && ok) playDraftChime(0.7); // preview so you know it works
      }}
      aria-label={soundOn ? "Mute draft sounds" : "Unmute draft sounds"}
      className={
        big
          ? `rounded-full border px-4 py-2 text-base font-semibold ${
              soundOn && audioUnlocked
                ? "border-gold/60 text-gold"
                : "border-white/30 text-white/60 hover:bg-white/10 hover:text-white"
            }`
          : `rounded-full border px-3 py-1 text-xs font-semibold ${
              soundOn && audioUnlocked
                ? "border-gold text-navy bg-gold/20"
                : "border-hairline text-navy/50"
            }`
      }
    >
      {soundOn ? (audioUnlocked ? "🔊 Sound on" : "🔇 Tap to enable sound") : "🔇 Sound off"}
    </button>
  );

  /* ---------- pick reveal overlay (phone + TV) ---------- */
  // Videos duck out while a pick reveal is on screen, then resume.
  const revealActive = reveal !== null;

  const revealOverlay = reveal && (
    <div
      className="draft-reveal-bg fixed inset-0 z-[950] flex items-center justify-center px-8"
      style={{ backgroundColor: `${teamOf(reveal.team_id).color}F2` }}
    >
      {revealPhase === "pickin" ? (
        // Held while the chime plays — no name yet.
        <div className="draft-reveal-card flex flex-col items-center text-center">
          <p className={`font-bold uppercase tracking-[0.4em] text-white/80 ${tv ? "text-4xl" : "text-xl"}`}>
            The pick is in
          </p>
          <p className={`mt-5 font-display font-bold uppercase tracking-widest text-gold ${tv ? "text-7xl" : "text-4xl"}`}>
            {teamOf(reveal.team_id).name}
          </p>
          <p className={`mt-4 font-semibold uppercase tracking-[0.3em] text-white/50 ${tv ? "text-xl" : "text-xs"}`}>
            {pickLabel(reveal.pick_number)}
          </p>
        </div>
      ) : (
        // Chime's done — drop the name.
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
      )}
    </div>
  );

  /* ---------- board (shared) ---------- */
  const board = (
    <div className="grid grid-cols-2 gap-3">
      {draft.teams.map((team) => (
        <div key={team.id} className={`overflow-hidden rounded-xl border ${tv ? "border-white/20" : "border-hairline bg-white"}`}>
          <div className={`${tv ? "px-4 py-3" : "px-3 py-2"} text-white`} style={{ backgroundColor: team.color }}>
            <p className={`font-display font-bold leading-tight ${tv ? "text-5xl" : "text-base"}`}>{team.name}</p>
            <p className={`${tv ? "text-xl" : "text-[11px]"} text-white/70`}>
              Capt. {team.captainName ?? "TBD"}
              {draft.status !== "complete" && team.id === draft.teams[0].id && " · 1st pick"}
            </p>
          </div>
          <ul className={tv ? "divide-y divide-white/10" : "divide-y divide-hairline"}>
            {picksFor(team.id).map((p) => (
              <li key={p.id} className={`draft-row-in flex items-center gap-2 px-4 ${tv ? "py-3.5" : "py-2"}`}>
                <span className={`${tv ? "text-2xl" : "text-[10px]"} w-9 shrink-0 font-bold tabular-nums ${tv ? "text-white/50" : "text-navy/40"}`}>
                  {p.pick_number}
                </span>
                <Avatar url={p.avatarUrl} name={p.name} color={team.color}
                  className={tv ? "h-14 w-14 shrink-0 text-lg" : "h-7 w-7 shrink-0 text-[10px]"} />
                <span className={`truncate font-semibold ${tv ? "text-4xl text-white" : "text-sm text-navy"}`}>
                  {p.name}
                </span>
              </li>
            ))}
            {picksFor(team.id).length === 0 && (
              <li className={`px-4 py-4 ${tv ? "text-2xl text-white/40" : "text-xs text-navy/40"}`}>No picks yet</li>
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
        {/* Control rail — everything AV in one column down the left edge */}
        <div className="fixed left-2 top-1/2 z-[920] flex -translate-y-1/2 flex-col gap-2">
          {(() => {
            const rail = (active: boolean) =>
              `w-24 rounded-lg border px-2 py-3 text-center text-sm font-semibold leading-tight transition-colors ${
                active
                  ? "border-gold/70 bg-gold/15 text-gold"
                  : "border-white/20 text-white/50 hover:bg-white/10 hover:text-white"
              }`;
            return (
              <>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await unlockAudio();
                    setAudioUnlocked(ok);
                    const next = !soundOn;
                    setSoundOn(next);
                    if (next && ok) playDraftChime(0.7);
                  }}
                  className={rail(soundOn && audioUnlocked)}
                >
                  <span className="block text-lg">{soundOn ? "🔊" : "🔇"}</span>
                  {soundOn ? (audioUnlocked ? "Sound" : "Enable") : "Muted"}
                </button>

                {musicId && (
                  <button
                    type="button"
                    onClick={() => {
                      // Cover / uncover only — audio keeps playing either way.
                      if (!showMusic) { setShowMusic(true); setMusicCovered(false); }
                      else setMusicCovered((v) => !v);
                    }}
                    className={rail(showMusic && !musicCovered)}
                  >
                    <span className="block text-lg">🎧</span>
                    Hype
                  </button>
                )}

                {clipId && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!showClip) { setShowClip(true); setClipCovered(false); }
                      else setClipCovered((v) => !v);
                    }}
                    className={rail(showClip && !clipCovered)}
                  >
                    <span className="block text-lg">🎬</span>
                    Clip
                  </button>
                )}

                {(showMusic || showClip) && (
                  <button
                    type="button"
                    // Covering only hides — unmounting is what actually stops
                    // the audio, so this is the real "kill it" control.
                    onClick={() => {
                      setShowMusic(false); setMusicCovered(false);
                      setShowClip(false);  setClipCovered(false);
                    }}
                    className={rail(false)}
                  >
                    <span className="block text-lg">⏹</span>
                    Stop
                  </button>
                )}
              </>
            );
          })()}
        </div>
        {/* Background music — TV cast only. Kept visible (YouTube requires the
            player be shown) but small and tucked into the bottom-left corner.
            loop=1 needs playlist=<same id> to actually repeat. */}
        {/* Pre-draft hype track — small, bottom-left. Pauses during a reveal. */}
        {musicId && showMusic && (
          <div className="fixed bottom-3 left-3 z-[910]">
            <div className="relative overflow-hidden rounded-lg shadow-lg">
              {/* No auto-pause here — only the clip ducks for picks. */}
              <YouTubePlayer
                videoId={musicId}
                width={220}
                height={124}
                className={`block transition-opacity ${musicCovered ? "opacity-0" : "opacity-70 hover:opacity-100"}`}
              />
              {/* Cover: navy panel matching the page background; hover for the ✕. */}
              {musicCovered && (
                <div className="group absolute inset-0 bg-navy">
                  <button
                    type="button"
                    onClick={() => setMusicCovered(false)}
                    aria-label="Uncover the hype player"
                    className="flex h-full w-full items-center justify-center text-lg text-white/0 transition-colors group-hover:text-white/70"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Between-picks clip — bigger, bottom-right. Also pauses on a reveal. */}
        {clipId && showClip && (
          <div className="fixed bottom-3 right-3 z-[910]">
            <div className="relative overflow-hidden rounded-lg shadow-2xl ring-1 ring-white/20">
              <YouTubePlayer
                videoId={clipId}
                width={640}
                height={360}
                paused={revealActive}
                className={`block transition-opacity ${clipCovered ? "opacity-0" : ""}`}
              />
              {clipCovered && (
                <div className="group absolute inset-0 bg-navy">
                  <button
                    type="button"
                    onClick={() => setClipCovered(false)}
                    aria-label="Uncover the clip"
                    className="flex h-full w-full items-center justify-center text-xl text-white/0 transition-colors group-hover:text-white/70"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {revealOverlay}
        <div className="mx-auto max-w-[1600px] space-y-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Image src="/crest-small.png" alt="" width={96} height={96} />
              <div>
                <h1 className="font-display text-7xl font-bold text-off-white">
                  {draft.eventYear} Wooglin Cup Draft
                </h1>
                <p className="mt-1 text-3xl text-hairline/70">{draft.eventName}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {draft.status === "live" && (
                <span className="animate-pulse rounded-full bg-gold px-7 py-3 text-3xl font-bold uppercase tracking-widest text-navy">
                  Live
                </span>
              )}
              <Link
                href="/draft"
                className="rounded-full border border-white/30 px-6 py-3 text-xl font-semibold text-white/60 hover:bg-white/10 hover:text-white"
              >
                ✕ Exit TV
              </Link>
            </div>
          </div>

          {draft.status === "live" && (
            <div className="rounded-2xl px-10 py-10 text-center" style={{ backgroundColor: onClock.color }}>
              <p className="text-3xl font-semibold uppercase tracking-[0.3em] text-white/70">On the clock</p>
              <p className="mt-3 font-display text-8xl font-bold text-white">{onClock.name}</p>
              <p className="mt-2 text-4xl text-white/80">
                {pickLabel(nextPick)} · Capt. {onClock.captainName ?? "TBD"}
              </p>
              {remaining !== null && (
                <p className={`mt-4 font-mono text-9xl font-bold tabular-nums ${overTime ? "animate-pulse text-usa-red" : "text-gold"}`}>
                  {fmtClock(remaining)}
                </p>
              )}
              {overTime && (
                <p className="mt-2 text-3xl font-semibold text-white/90">Taking their sweet time…</p>
              )}
            </div>
          )}

          {/* Pre-draft lobby — the room fills in here before it kicks off */}
          {draft.status === "scheduled" && (
            <div className="rounded-2xl border border-gold/50 bg-white/5 px-8 py-8 text-center">
              <p className="text-xl font-semibold uppercase tracking-[0.3em] text-gold">Draft Day</p>
              <p className="mt-3 font-display text-5xl font-bold text-off-white">
                {draft.scheduled_at
                  ? new Date(draft.scheduled_at).toLocaleDateString("en-US", {
                      weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
                    })
                  : "Standing by…"}
              </p>
              <p className="mt-3 text-2xl text-hairline/70">
                {draft.pool.length} players in the pool · {draft.teams[0].name} picks first
              </p>
              {draft.viewerIsAdmin && (
                <button
                  onClick={start}
                  disabled={isPending || draft.pool.length === 0}
                  className="mt-6 rounded-xl bg-europe-green px-10 py-4 text-2xl font-bold text-white shadow-xl disabled:opacity-50"
                >
                  {isPending ? "Starting…" : "🐉 Start the Draft"}
                </button>
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
            <p className="text-center text-3xl text-hairline/70">
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
          {draft.viewerIsAdmin && (
            <button
              onClick={start}
              disabled={isPending || draft.pool.length === 0}
              className="mt-4 w-full rounded-lg bg-europe-green py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {isPending ? "Starting…" : "🐉 Start the Draft"}
            </button>
          )}
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

      {/* Sound + TV mode */}
      <div className="flex flex-col items-center gap-2">
        {soundButton(false)}
        <p className="text-center text-xs text-navy/40">
          Casting to a TV? <Link href="/draft?tv=1" className="underline underline-offset-2">Open TV mode</Link>
        </p>
      </div>
    </div>
  );
}
