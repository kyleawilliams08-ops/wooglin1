import { requirePlayer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { LiveRefresher } from "@/components/LiveRefresher";
import { computePlayingHcps, computeHoleResults, type GrossScores } from "@/lib/matchcalc";
import { matchOutcome } from "@/lib/matchplay";

type EPRef = { display_name: string; player_id: string | null } | null;

function holeNums(side: string): number[] {
  if (side === "front") return Array.from({ length: 9 }, (_, i) => i + 1);
  if (side === "back")  return Array.from({ length: 9 }, (_, i) => i + 10);
  return Array.from({ length: 18 }, (_, i) => i + 1);
}

function fmtPts(n: number): string {
  if (n % 1 === 0.5) return n < 1 ? "½" : `${Math.floor(n)}½`;
  return String(n);
}

function fmtTeeTime(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, "0")} ${ampm}`;
}

export default async function LivePage() {
  await requirePlayer();
  const supabase = createClient();

  // Active event (most recent if several are marked active)
  const { data: events } = await supabase
    .from("events")
    .select("id, name, year, status")
    .eq("status", "active")
    .order("year", { ascending: false })
    .limit(1);
  const event = events?.[0];

  if (!event) {
    return (
      <div className="px-4 py-6">
        <h1 className="text-2xl font-display font-bold text-navy">Live Scoreboard</h1>
        <p className="mt-2 text-sm text-navy/50">No active event. The commissioner can activate one under Admin → Events.</p>
      </div>
    );
  }

  // Teams (home = first by name, matching the rest of the app)
  const { data: teams } = await supabase
    .from("teams").select("id, name, color").eq("event_id", event.id).order("name");
  const homeTeam = teams?.[0];
  const awayTeam = teams?.[1];
  const homeLabel = homeTeam?.name ?? "Home";
  const awayLabel = awayTeam?.name ?? "Away";
  const abbrev = (name: string) => name.slice(0, 3).toUpperCase();

  // Rounds
  const { data: roundsRaw } = await supabase
    .from("rounds")
    .select("id, round_number, name, side, course_tee_id, formats(name, hcp_allowance, hcp_allowance_secondary), course_tees(tee_name, courses(name))")
    .eq("event_id", event.id)
    .order("round_number");
  const rounds = (roundsRaw ?? []) as unknown as {
    id: string; round_number: number; name: string | null; side: string; course_tee_id: string;
    formats: { name: string; hcp_allowance: number; hcp_allowance_secondary: number | null } | null;
    course_tees: { tee_name: string; courses: { name: string } | null } | null;
  }[];
  const roundIds = rounds.map((r) => r.id);

  // Matchups with participants
  const { data: matchupsRaw } = roundIds.length > 0
    ? await supabase
        .from("matchups")
        .select(`
          id, round_id, match_number, status, result, match_score, tee_time,
          home_p1:event_participants!matchups_home_p1_id_fkey(display_name, player_id),
          home_p2:event_participants!matchups_home_p2_id_fkey(display_name, player_id),
          away_p1:event_participants!matchups_away_p1_id_fkey(display_name, player_id),
          away_p2:event_participants!matchups_away_p2_id_fkey(display_name, player_id)
        `)
        .in("round_id", roundIds)
        .order("match_number")
    : { data: [] };
  const matchups = (matchupsRaw ?? []) as unknown as {
    id: string; round_id: string; match_number: number; status: string;
    result: string | null; match_score: string | null; tee_time: string | null;
    home_p1: EPRef; home_p2: EPRef; away_p1: EPRef; away_p2: EPRef;
  }[];

  // Holes for every tee used by a round
  const teeIds = Array.from(new Set(rounds.map((r) => r.course_tee_id)));
  const { data: holesRaw } = teeIds.length > 0
    ? await supabase
        .from("holes")
        .select("course_tee_id, hole_number, par, stroke_index")
        .in("course_tee_id", teeIds)
        .order("hole_number")
    : { data: [] };
  const holesByTee: Record<string, { hole_number: number; par: number; stroke_index: number }[]> = {};
  for (const h of holesRaw ?? []) {
    (holesByTee[h.course_tee_id] ??= []).push(h);
  }

  // Handicaps for the whole event
  const { data: hcpRows } = await supabase
    .from("participant_handicaps")
    .select("player_id, course_tee_id, calculated_hcp, override_hcp")
    .eq("event_id", event.id);
  const effectiveHcp = (pid: string | null | undefined, teeId: string): number => {
    if (!pid) return 0;
    const row = hcpRows?.find((h) => h.player_id === pid && h.course_tee_id === teeId);
    return row?.override_hcp ?? row?.calculated_hcp ?? 0;
  };

  // Scores for all matchups in one query
  const matchupIds = matchups.map((m) => m.id);
  const { data: scoresRaw } = matchupIds.length > 0
    ? await supabase
        .from("hole_scores")
        .select("matchup_id, hole_number, home_p1_gross, home_p2_gross, away_p1_gross, away_p2_gross")
        .in("matchup_id", matchupIds)
    : { data: [] };
  const scoresByMatchup: Record<string, Record<number, GrossScores>> = {};
  for (const s of scoresRaw ?? []) {
    (scoresByMatchup[s.matchup_id] ??= {})[s.hole_number] = s;
  }

  // ── Compute per-matchup live state ─────────────────────────────────────────

  type MatchState = {
    matchup: (typeof matchups)[number];
    chip: string;          // e.g. "EUR wins 2&1" · "USA 1 up thru 6" · "AS thru 3" · "1:00 PM"
    chipColor: string | null; // leading/winning team color
    final: boolean;
    homePts: number;       // points if final
    awayPts: number;
  };

  const stateByRound: Record<string, MatchState[]> = {};
  let homeTotal = 0, awayTotal = 0;

  for (const round of rounds) {
    const fmt = round.formats;
    const nineHole = round.side !== "full";
    const relevant = new Set(holeNums(round.side));
    const holes = (holesByTee[round.course_tee_id] ?? []).filter((h) => relevant.has(h.hole_number));

    for (const m of matchups.filter((x) => x.round_id === round.id)) {
      let state: MatchState;

      if (m.status === "complete" && m.result) {
        // Completed: the stored result is the source of truth
        const homePts = m.result === "home" ? 1 : m.result === "halve" ? 0.5 : 0;
        const awayPts = m.result === "away" ? 1 : m.result === "halve" ? 0.5 : 0;
        const chip = m.result === "halve"
          ? "Halved"
          : `${abbrev(m.result === "home" ? homeLabel : awayLabel)} wins${m.match_score ? ` ${m.match_score}` : ""}`;
        const chipColor = m.result === "home" ? homeTeam?.color ?? null
          : m.result === "away" ? awayTeam?.color ?? null : null;
        state = { matchup: m, chip, chipColor, final: true, homePts, awayPts };
        homeTotal += homePts;
        awayTotal += awayPts;

      } else if (fmt && holes.length > 0) {
        // Live: compute the standing from hole scores
        const phcps = computePlayingHcps(fmt, {
          homeP1: effectiveHcp(m.home_p1?.player_id, round.course_tee_id),
          homeP2: m.home_p2 ? effectiveHcp(m.home_p2.player_id, round.course_tee_id) : null,
          awayP1: effectiveHcp(m.away_p1?.player_id, round.course_tee_id),
          awayP2: m.away_p2 ? effectiveHcp(m.away_p2.player_id, round.course_tee_id) : null,
        }, nineHole);
        const results = computeHoleResults(fmt, phcps, scoresByMatchup[m.id] ?? {}, holes, nineHole);
        const o = matchOutcome(results, holes.length);

        if (o.result === null) {
          const tee = fmtTeeTime(m.tee_time);
          state = { matchup: m, chip: tee ?? "Not started", chipColor: null, final: false, homePts: 0, awayPts: 0 };
        } else {
          const diff = o.homeWon - o.awayWon;
          const dormie = !o.decided && diff !== 0 && Math.abs(diff) === o.remaining;
          let chip: string;
          let chipColor: string | null = null;
          if (o.decided) {
            chip = o.result === "halve"
              ? "Halved"
              : `${abbrev(o.result === "home" ? homeLabel : awayLabel)} wins ${o.score}`;
            chipColor = o.result === "home" ? homeTeam?.color ?? null
              : o.result === "away" ? awayTeam?.color ?? null : null;
          } else if (diff === 0) {
            chip = `AS thru ${o.holesPlayed}`;
          } else {
            const leader = diff > 0 ? homeLabel : awayLabel;
            chip = `${abbrev(leader)} ${Math.abs(diff)} up thru ${o.holesPlayed}${dormie ? " · dormie" : ""}`;
            chipColor = diff > 0 ? homeTeam?.color ?? null : awayTeam?.color ?? null;
          }
          state = { matchup: m, chip, chipColor, final: false, homePts: 0, awayPts: 0 };
        }
      } else {
        state = { matchup: m, chip: fmtTeeTime(m.tee_time) ?? "Not started", chipColor: null, final: false, homePts: 0, awayPts: 0 };
      }

      (stateByRound[round.id] ??= []).push(state);
    }
  }

  const totalMatches = matchups.length;
  const toWin = totalMatches > 0 ? totalMatches / 2 + 0.5 : null;

  const names = (a: EPRef, b: EPRef) =>
    [a?.display_name, b?.display_name].filter(Boolean).join(" / ") || "TBD";

  return (
    <div className="pb-6">
      <LiveRefresher />

      {/* Big team totals — sticky so it stays visible while scrolling matches */}
      <div className="sticky top-0 z-10 bg-navy px-4 pt-5 pb-4 text-center shadow-md">
        <p className="text-white/50 text-xs uppercase tracking-widest">{event.name}</p>
        <div className="mt-2 grid grid-cols-3 items-center">
          <div>
            <p className="text-4xl font-bold tabular-nums" style={{ color: homeTeam?.color ?? "#fff" }}>
              {fmtPts(homeTotal)}
            </p>
            <p className="text-white/70 text-sm font-semibold mt-0.5">{homeLabel}</p>
          </div>
          <div className="text-white/40 text-xs">
            {toWin != null && (
              <>
                <p className="text-lg text-white/60 font-semibold tabular-nums">{fmtPts(toWin)}</p>
                <p>to win</p>
              </>
            )}
          </div>
          <div>
            <p className="text-4xl font-bold tabular-nums" style={{ color: awayTeam?.color ?? "#fff" }}>
              {fmtPts(awayTotal)}
            </p>
            <p className="text-white/70 text-sm font-semibold mt-0.5">{awayLabel}</p>
          </div>
        </div>
      </div>

      {/* Rounds + matches */}
      <div className="px-4 pt-4 space-y-5">
        {rounds.length === 0 && (
          <p className="text-sm text-navy/50">No rounds yet.</p>
        )}

        {rounds.map((round) => {
          const states = stateByRound[round.id] ?? [];
          const sideLabel: Record<string, string> = { front: "Front 9", back: "Back 9", full: "Full 18" };
          return (
            <div key={round.id}>
              <p className="text-xs font-semibold text-navy/50 uppercase tracking-wide mb-2">
                R{round.round_number}{round.name ? ` · ${round.name}` : ""} — {round.course_tees?.courses?.name} · {sideLabel[round.side]} · {round.formats?.name}
              </p>
              {states.length === 0 ? (
                <p className="text-xs text-navy/40 mb-2">No matches yet.</p>
              ) : (
                <ul className="space-y-2">
                  {states.map(({ matchup: m, chip, chipColor, final }) => (
                    <li key={m.id}>
                      <Link
                        href={`/live/match/${m.id}`}
                        className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-white px-4 py-3 hover:bg-parchment transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-navy truncate">
                            <span style={{ color: homeTeam?.color ?? undefined }}>{names(m.home_p1, m.home_p2)}</span>
                            <span className="text-navy/40 font-normal"> vs </span>
                            <span style={{ color: awayTeam?.color ?? undefined }}>{names(m.away_p1, m.away_p2)}</span>
                          </p>
                          <p className="text-xs text-navy/40 mt-0.5">Match {m.match_number}</p>
                        </div>
                        <span
                          className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${final ? "" : "border border-hairline"}`}
                          style={chipColor
                            ? { color: "#fff", backgroundColor: chipColor }
                            : { color: "#0C2D55", backgroundColor: final ? "#E4E0D6" : "transparent" }}
                        >
                          {chip}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
