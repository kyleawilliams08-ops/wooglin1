import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { LiveRefresher } from "@/components/LiveRefresher";
import { computePlayingHcps, computeHoleResults, type GrossScores } from "@/lib/matchcalc";
import { matchOutcome } from "@/lib/matchplay";
import { recordLineup } from "@/lib/feed";

type EPRef = { id: string; display_name: string; player_id: string | null } | null;

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

function dayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// The one matches board: team totals, day tabs, and phase-aware cards —
// tee time → captain lineup pickers → live standing → final result.
export default async function MatchesPage({
  searchParams,
}: {
  searchParams: { day?: string };
}) {
  const player = await requirePlayer();
  const admin = isAdmin(player);
  const supabase = createClient();

  const { data: events } = await supabase
    .from("events")
    .select("id, name, year")
    .eq("status", "active")
    .order("year", { ascending: false })
    .limit(1);
  const event = events?.[0];

  if (!event) {
    return (
      <div className="px-4 py-6">
        <h1 className="text-2xl font-display font-bold text-navy">Matches</h1>
        <p className="mt-2 text-sm text-navy/50">
          No active event.{admin ? " Activate one under Menu → Events." : ""}
        </p>
      </div>
    );
  }
  const eventId = event.id;

  const { data: teams } = await supabase
    .from("teams").select("id, name, color").eq("event_id", eventId).order("name");
  const homeTeam = teams?.[0];
  const awayTeam = teams?.[1];
  const homeLabel = homeTeam?.name ?? "Home";
  const awayLabel = awayTeam?.name ?? "Away";
  const abbrev = (name: string) => name.slice(0, 3).toUpperCase();

  // Captains fill lineups for their own team
  const { data: captainEp } = await supabase
    .from("event_participants")
    .select("team_id")
    .eq("event_id", eventId)
    .eq("player_id", player.id)
    .eq("is_captain", true)
    .maybeSingle();
  const canEditHome = admin || (captainEp != null && captainEp.team_id === homeTeam?.id);
  const canEditAway = admin || (captainEp != null && captainEp.team_id === awayTeam?.id);

  const { data: roundsRaw } = await supabase
    .from("rounds")
    .select("id, round_number, name, side, played_at, course_tee_id, formats(name, hcp_allowance, hcp_allowance_secondary), course_tees(tee_name, courses(name))")
    .eq("event_id", eventId)
    .order("round_number");
  const rounds = (roundsRaw ?? []) as unknown as {
    id: string; round_number: number; name: string | null; side: string; played_at: string | null;
    course_tee_id: string;
    formats: { name: string; hcp_allowance: number; hcp_allowance_secondary: number | null } | null;
    course_tees: { tee_name: string; courses: { name: string } | null } | null;
  }[];

  const { data: matchupsRaw } = rounds.length > 0
    ? await supabase
        .from("matchups")
        .select(`
          id, round_id, match_number, status, result, match_score, tee_time,
          home_p1_id, home_p2_id, away_p1_id, away_p2_id,
          home_p1:event_participants!matchups_home_p1_id_fkey(id, display_name, player_id),
          home_p2:event_participants!matchups_home_p2_id_fkey(id, display_name, player_id),
          away_p1:event_participants!matchups_away_p1_id_fkey(id, display_name, player_id),
          away_p2:event_participants!matchups_away_p2_id_fkey(id, display_name, player_id)
        `)
        .in("round_id", rounds.map((r) => r.id))
        .order("match_number")
    : { data: [] };
  const matchups = (matchupsRaw ?? []) as unknown as {
    id: string; round_id: string; match_number: number; status: string;
    result: string | null; match_score: string | null; tee_time: string | null;
    home_p1_id: string | null; home_p2_id: string | null;
    away_p1_id: string | null; away_p2_id: string | null;
    home_p1: EPRef; home_p2: EPRef; away_p1: EPRef; away_p2: EPRef;
  }[];

  // Holes per tee (for live standings)
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

  const { data: hcpRows } = await supabase
    .from("participant_handicaps")
    .select("player_id, course_tee_id, calculated_hcp, override_hcp")
    .eq("event_id", eventId);
  const effectiveHcp = (pid: string | null | undefined, teeId: string): number => {
    if (!pid) return 0;
    const row = hcpRows?.find((h) => h.player_id === pid && h.course_tee_id === teeId);
    return row?.override_hcp ?? row?.calculated_hcp ?? 0;
  };

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

  // Team rosters for the lineup pickers
  const { data: participants } = await supabase
    .from("event_participants")
    .select("id, display_name, team_id")
    .eq("event_id", eventId)
    .order("display_name");
  const rosterFor = (teamId: string | undefined) =>
    (participants ?? []).filter((p) => p.team_id === teamId);

  // ── Per-matchup live state ─────────────────────────────────────────────────

  type MatchState = {
    matchup: (typeof matchups)[number];
    chip: string;
    chipColor: string | null;
    final: boolean;
    underway: boolean; // any scored hole → lineups lock
  };

  const stateById: Record<string, MatchState> = {};
  let homeTotal = 0, awayTotal = 0;

  for (const round of rounds) {
    const fmt = round.formats;
    const nineHole = round.side !== "full";
    const relevant = new Set(holeNums(round.side));
    const holes = (holesByTee[round.course_tee_id] ?? []).filter((h) => relevant.has(h.hole_number));

    for (const m of matchups.filter((x) => x.round_id === round.id)) {
      let state: MatchState;

      if (m.status === "complete" && m.result) {
        const homePts = m.result === "home" ? 1 : m.result === "halve" ? 0.5 : 0;
        const awayPts = m.result === "away" ? 1 : m.result === "halve" ? 0.5 : 0;
        homeTotal += homePts;
        awayTotal += awayPts;
        const chip = m.result === "halve"
          ? "Halved"
          : `${abbrev(m.result === "home" ? homeLabel : awayLabel)} wins${m.match_score ? ` ${m.match_score}` : ""}`;
        const chipColor = m.result === "home" ? homeTeam?.color ?? null
          : m.result === "away" ? awayTeam?.color ?? null : null;
        state = { matchup: m, chip, chipColor, final: true, underway: true };

      } else if (fmt && holes.length > 0) {
        const phcps = computePlayingHcps(fmt, {
          homeP1: effectiveHcp(m.home_p1?.player_id, round.course_tee_id),
          homeP2: m.home_p2 ? effectiveHcp(m.home_p2.player_id, round.course_tee_id) : null,
          awayP1: effectiveHcp(m.away_p1?.player_id, round.course_tee_id),
          awayP2: m.away_p2 ? effectiveHcp(m.away_p2.player_id, round.course_tee_id) : null,
        }, nineHole);
        const results = computeHoleResults(fmt, phcps, scoresByMatchup[m.id] ?? {}, holes, nineHole);
        const o = matchOutcome(results, holes.length);

        if (o.result === null) {
          state = { matchup: m, chip: fmtTeeTime(m.tee_time) ?? "Not started", chipColor: null, final: false, underway: false };
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
          state = { matchup: m, chip, chipColor, final: false, underway: o.holesPlayed > 0 };
        }
      } else {
        state = { matchup: m, chip: fmtTeeTime(m.tee_time) ?? "Not started", chipColor: null, final: false, underway: false };
      }

      stateById[m.id] = state;
    }
  }

  const totalMatches = matchups.length;
  const toWin = totalMatches > 0 ? totalMatches / 2 + 0.5 : null;

  // ── Day tabs ───────────────────────────────────────────────────────────────

  type Day = { key: string; label: string; rounds: typeof rounds };
  const days: Day[] = [];
  for (const r of rounds) {
    const key = r.played_at ?? `round-${r.id}`;
    const label = r.played_at ? dayLabel(r.played_at) : (r.name ?? `Round ${r.round_number}`);
    const existing = days.find((d) => d.key === key);
    if (existing) existing.rounds.push(r);
    else days.push({ key, label, rounds: [r] });
  }
  const selectedDay = days.find((d) => d.key === searchParams.day) ?? days[0];

  // ── Server action: captains/admins set a side's lineup ──────────────────

  async function setLineup(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    const matchupId = formData.get("matchup_id") as string;
    const side = formData.get("side") as "home" | "away";

    const { data: me } = await supabase
      .from("players").select("id, role").eq("auth_user_id", user.id).single();
    if (!me) redirect("/login");
    const meAdmin = me.role === "admin" || me.role === "assistant";
    if (!meAdmin) {
      const { data: cap } = await supabase
        .from("event_participants")
        .select("team_id")
        .eq("event_id", eventId)
        .eq("player_id", me.id)
        .eq("is_captain", true)
        .maybeSingle();
      const sideTeamId = side === "home" ? homeTeam?.id : awayTeam?.id;
      if (!cap || cap.team_id !== sideTeamId) throw new Error("Not your lineup to set");

      const { data: existing } = await supabase
        .from("hole_scores")
        .select("home_p1_gross, home_p2_gross, away_p1_gross, away_p2_gross")
        .eq("matchup_id", matchupId);
      const hasScores = (existing ?? []).some(
        (r) => r.home_p1_gross != null || r.home_p2_gross != null || r.away_p1_gross != null || r.away_p2_gross != null,
      );
      if (hasScores) throw new Error("Lineup is locked — this match is underway");
    }

    const p1 = (formData.get("p1") as string) || null;
    let p2 = (formData.get("p2") as string) || null;

    const { data: mrow } = await supabase
      .from("matchups")
      .select("rounds(formats(name))")
      .eq("id", matchupId)
      .single();
    const fmtName = (mrow as unknown as { rounds: { formats: { name: string } | null } | null } | null)
      ?.rounds?.formats?.name;
    if (fmtName === "Singles" || (p2 !== null && p2 === p1)) p2 = null;

    const update = side === "home"
      ? { home_p1_id: p1, home_p2_id: p2 }
      : { away_p1_id: p1, away_p2_id: p2 };
    const { error } = await supabase.from("matchups").update(update).eq("id", matchupId);
    if (error) throw new Error(`Couldn't save lineup: ${error.message}`);
    await recordLineup(supabase, matchupId, side); // best-effort feed entry
    revalidatePath("/matches");
  }

  const selectCls = "w-full rounded-lg border border-hairline bg-white px-2 py-1.5 text-sm text-navy";
  const names = (a: EPRef, b: EPRef) =>
    [a?.display_name, b?.display_name].filter(Boolean).join(" / ") || "TBD";

  return (
    <div className="pb-6">
      <LiveRefresher />

      {/* Sticky team totals */}
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

      <div className="px-4 pt-4 space-y-5">
        {rounds.length === 0 && (
          <p className="text-sm text-navy/50">
            No rounds yet.{admin ? " Set them up under Menu → Events." : " Check back once the schedule drops."}
          </p>
        )}

        {/* Day tabs */}
        {days.length > 1 && (
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
            {days.map((d) => (
              <Link
                key={d.key}
                href={`/matches?day=${encodeURIComponent(d.key)}`}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold border transition-colors ${
                  d.key === selectedDay?.key
                    ? "bg-navy text-off-white border-navy"
                    : "bg-white text-navy/60 border-hairline"
                }`}
              >
                {d.label}
              </Link>
            ))}
          </div>
        )}

        {selectedDay?.rounds.map((round) => {
          const ms = matchups.filter((m) => m.round_id === round.id);
          const sideLabel: Record<string, string> = { front: "Front 9", back: "Back 9", full: "Full 18" };
          const isSingles = round.formats?.name === "Singles";

          const usedElsewhere = (excludeId: string) => {
            const used = new Set<string>();
            for (const m of ms) {
              if (m.id === excludeId) continue;
              for (const id of [m.home_p1_id, m.home_p2_id, m.away_p1_id, m.away_p2_id]) {
                if (id) used.add(id);
              }
            }
            return used;
          };

          return (
            <div key={round.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-navy/50 uppercase tracking-wide">
                  R{round.round_number}{round.name ? ` · ${round.name}` : ""} — {round.course_tees?.courses?.name} · {sideLabel[round.side]} · {round.formats?.name}
                </p>
                {admin && (
                  <Link
                    href={`/admin/events/${eventId}/rounds/${round.id}/matchups`}
                    className="text-xs text-navy/50 underline underline-offset-2 shrink-0"
                  >
                    Manage
                  </Link>
                )}
              </div>

              {ms.length === 0 ? (
                <p className="text-xs text-navy/40">
                  Pairings not set yet.{admin ? " Use Manage to create the matches." : ""}
                </p>
              ) : (
                ms.map((m) => {
                  const st = stateById[m.id];
                  const used = usedElsewhere(m.id);
                  const locked = st.final || st.underway;
                  const lineupIncomplete =
                    (canEditHome && !m.home_p1_id) || (canEditAway && !m.away_p1_id);
                  const canEditAny = (canEditHome || canEditAway) && !locked;

                  const sideBlock = (
                    side: "home" | "away",
                    team: typeof homeTeam,
                    p1: EPRef, p2: EPRef,
                    editable: boolean,
                  ) => {
                    const roster = rosterFor(team?.id).filter(
                      (p) => !used.has(p.id) || p.id === p1?.id || p.id === p2?.id,
                    );
                    return (
                      <div className="flex-1 min-w-0 rounded-lg p-2.5" style={{ backgroundColor: `${team?.color ?? "#0C2D55"}12` }}>
                        <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: team?.color ?? "#0C2D55" }}>
                          {team?.name ?? side}
                        </p>
                        {editable ? (
                          <form action={setLineup} className="space-y-1.5">
                            <input type="hidden" name="matchup_id" value={m.id} />
                            <input type="hidden" name="side" value={side} />
                            <select name="p1" defaultValue={p1?.id ?? ""} className={selectCls}>
                              <option value="">{isSingles ? "Player…" : "Player 1…"}</option>
                              {roster.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                            </select>
                            {!isSingles && (
                              <select name="p2" defaultValue={p2?.id ?? ""} className={selectCls}>
                                <option value="">Player 2 (blank for 2v1)</option>
                                {roster.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                              </select>
                            )}
                            <button type="submit"
                              className="w-full rounded-lg py-1.5 text-xs font-semibold text-white"
                              style={{ backgroundColor: team?.color ?? "#0C2D55" }}>
                              Save lineup
                            </button>
                          </form>
                        ) : (
                          <p className="text-sm font-semibold text-navy leading-snug">
                            {[p1?.display_name, p2?.display_name].filter(Boolean).join(" / ") || <span className="text-navy/30">TBD</span>}
                          </p>
                        )}
                      </div>
                    );
                  };

                  return (
                    <div key={m.id} className="rounded-xl border border-hairline bg-white p-3 space-y-2">
                      {/* Header: match number, tee time, status + admin links */}
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-navy shrink-0">
                          Match {m.match_number}
                          {!st.underway && fmtTeeTime(m.tee_time) && (
                            <span className="font-semibold text-navy/50"> · {fmtTeeTime(m.tee_time)}</span>
                          )}
                        </p>
                        <div className="flex items-center gap-2 min-w-0">
                          {admin && (
                            <span className="flex items-center gap-2 text-xs shrink-0">
                              <Link href={`/admin/events/${eventId}/rounds/${round.id}/matchups/${m.id}`}
                                className="text-navy/50 underline underline-offset-2">Edit</Link>
                              <Link href={`/print/match/${m.id}`} target="_blank"
                                className="text-navy/50 underline underline-offset-2">Print</Link>
                            </span>
                          )}
                          <span
                            className={`truncate text-xs font-semibold px-2.5 py-1 rounded-full ${st.chipColor ? "" : "border border-hairline"}`}
                            style={st.chipColor
                              ? { color: "#fff", backgroundColor: st.chipColor }
                              : { color: "#0C2D55" }}
                          >
                            {st.chip}
                          </span>
                        </div>
                      </div>

                      {/* Pairing line → the match page */}
                      <Link href={`/live/match/${m.id}`} className="block hover:bg-parchment -mx-1 rounded px-1 transition-colors">
                        <p className="text-sm font-semibold text-navy truncate">
                          <span style={{ color: homeTeam?.color ?? undefined }}>{names(m.home_p1, m.home_p2)}</span>
                          <span className="text-navy/40 font-normal"> vs </span>
                          <span style={{ color: awayTeam?.color ?? undefined }}>{names(m.away_p1, m.away_p2)}</span>
                          <span className="text-navy/30 float-right">›</span>
                        </p>
                      </Link>

                      {/* Lineup pickers: open when something's missing, tucked away otherwise */}
                      {canEditAny && (
                        <details open={lineupIncomplete} className="group border-t border-hairline pt-2">
                          <summary className="cursor-pointer select-none list-none text-xs font-semibold text-navy/50 [&::-webkit-details-marker]:hidden">
                            {lineupIncomplete ? "⚡ Set lineup" : "Change lineup"} <span className="inline-block transition-transform group-open:rotate-90">›</span>
                          </summary>
                          <div className="mt-2 flex gap-2.5 items-stretch">
                            {sideBlock("home", homeTeam, m.home_p1, m.home_p2, canEditHome)}
                            <span className="self-center text-xs font-bold text-navy/30">VS</span>
                            {sideBlock("away", awayTeam, m.away_p1, m.away_p2, canEditAway)}
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
