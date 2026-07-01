import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import {
  playingHandicap,
  normalizeToLowest,
  strokesGivenOnHole,
  nineHoleSIRank,
  teamHandicap,
  twoTeamHandicaps,
} from "@/lib/handicap";

// ── Types ────────────────────────────────────────────────────────────────────

type EPRef = { id: string; display_name: string; player_id: string } | null;
type HoleRow = { hole_number: number; par: number; stroke_index: number };
type ScoreRow = {
  hole_number: number;
  home_p1_gross: number | null;
  home_p2_gross: number | null;
  away_p1_gross: number | null;
  away_p2_gross: number | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

type HoleResult = "home" | "away" | "halve" | null;

function holeNums(side: string): number[] {
  if (side === "front") return Array.from({ length: 9 }, (_, i) => i + 1);
  if (side === "back")  return Array.from({ length: 9 }, (_, i) => i + 10);
  return Array.from({ length: 18 }, (_, i) => i + 1);
}

/**
 * Match-play result label with proper closeout.
 * Walks holes in order tracking the running margin; the match is decided the
 * moment a side leads by more holes than remain (e.g. 2 up with 1 to play = "2&1").
 * `results` must be in hole order; nulls (unscored holes) are skipped.
 */
function matchScoreLabel(
  results: HoleResult[],
  totalHoles: number,
  homeName: string,
  awayName: string,
): string {
  let diff = 0;   // positive = home ahead
  let played = 0;
  for (const r of results) {
    if (r === null) continue;
    played++;
    if (r === "home") diff++;
    else if (r === "away") diff--;
    const remaining = totalHoles - played;
    if (Math.abs(diff) > remaining) {
      const name = diff > 0 ? homeName : awayName;
      return remaining === 0
        ? `${name} wins ${Math.abs(diff)} up`
        : `${name} wins ${Math.abs(diff)}&${remaining}`;
    }
  }
  const remaining = totalHoles - played;
  if (played < totalHoles) {
    if (diff === 0) return "All Square";
    const name = diff > 0 ? homeName : awayName;
    return `${name} ${Math.abs(diff)} up (${remaining} to play)`;
  }
  // All holes played and not clinched early → only reachable when tied.
  if (diff === 0) return "Halved";
  const name = diff > 0 ? homeName : awayName;
  return `${name} wins ${Math.abs(diff)} up`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function ScorecardPage({
  params,
}: {
  params: { id: string; roundId: string; matchupId: string };
}) {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const supabase = createClient();
  const matchupsPath = `/admin/events/${params.id}/rounds/${params.roundId}/matchups`;

  // Round
  const { data: roundRaw } = await supabase
    .from("rounds")
    .select("id, round_number, name, side, course_tee_id, formats(id, name, hcp_allowance, hcp_allowance_secondary), course_tees(tee_name, courses(name))")
    .eq("id", params.roundId)
    .single();
  const round = roundRaw as unknown as {
    id: string; round_number: number; name: string | null; side: string; course_tee_id: string;
    formats: { id: string; name: string; hcp_allowance: number; hcp_allowance_secondary: number | null } | null;
    course_tees: { tee_name: string; courses: { name: string } | null } | null;
  } | null;
  if (!round?.formats) redirect(`/admin/events/${params.id}`);

  const fmt = round.formats!;
  const nineHole = round.side !== "full";
  const pct  = fmt.hcp_allowance;
  const pct2 = fmt.hcp_allowance_secondary ?? 0;

  // Matchup
  const { data: matchupRaw } = await supabase
    .from("matchups")
    .select(`
      id, match_number, status, result, match_score,
      home_p1:event_participants!matchups_home_p1_id_fkey(id, display_name, player_id),
      home_p2:event_participants!matchups_home_p2_id_fkey(id, display_name, player_id),
      away_p1:event_participants!matchups_away_p1_id_fkey(id, display_name, player_id),
      away_p2:event_participants!matchups_away_p2_id_fkey(id, display_name, player_id)
    `)
    .eq("id", params.matchupId)
    .single();
  const matchup = matchupRaw as unknown as {
    id: string; match_number: number; status: string; result: string | null; match_score: string | null;
    home_p1: EPRef; home_p2: EPRef; away_p1: EPRef; away_p2: EPRef;
  } | null;
  if (!matchup) redirect(matchupsPath);

  // Teams for display labels
  const { data: teams } = await supabase
    .from("teams").select("id, name, color").eq("event_id", params.id).order("name");
  const homeTeam = teams?.[0];
  const awayTeam = teams?.[1];
  const homeLabel = homeTeam?.name ?? "Home";
  const awayLabel = awayTeam?.name ?? "Away";

  // Holes
  const holes: HoleRow[] = [];
  const relevantHoles = holeNums(round.side);
  const { data: holesRaw } = await supabase
    .from("holes")
    .select("hole_number, par, stroke_index")
    .eq("course_tee_id", round.course_tee_id)
    .in("hole_number", relevantHoles)
    .order("hole_number");
  for (const h of holesRaw ?? []) holes.push(h);

  // Participant handicaps
  const playerIds = [
    matchup.home_p1?.player_id,
    matchup.home_p2?.player_id,
    matchup.away_p1?.player_id,
    matchup.away_p2?.player_id,
  ].filter(Boolean) as string[];

  const { data: hcpRows } = await supabase
    .from("participant_handicaps")
    .select("player_id, calculated_hcp, override_hcp")
    .eq("event_id", params.id)
    .eq("course_tee_id", round.course_tee_id)
    .in("player_id", playerIds.length > 0 ? playerIds : ["00000000-0000-0000-0000-000000000000"]);

  const effectiveHcp = (pid: string | null | undefined): number => {
    if (!pid) return 0;
    const row = hcpRows?.find((h) => h.player_id === pid);
    return row?.override_hcp ?? row?.calculated_hcp ?? 0;
  };
  const missingHcps = playerIds.some((pid) => !hcpRows?.find((h) => h.player_id === pid));

  // Course hcps per player
  const hp1CH = effectiveHcp(matchup.home_p1?.player_id);
  const hp2CH = matchup.home_p2 ? effectiveHcp(matchup.home_p2.player_id) : null;
  const ap1CH = effectiveHcp(matchup.away_p1?.player_id);
  const ap2CH = matchup.away_p2 ? effectiveHcp(matchup.away_p2.player_id) : null;

  // ── Playing handicaps by format ──────────────────────────────────────────

  let homeP1Phcp = 0, homeP2Phcp: number | null = null;
  let awayP1Phcp = 0, awayP2Phcp: number | null = null;
  let homeTeamPhcp: number | null = null, awayTeamPhcp: number | null = null;

  const isOneScore = ["Pinehurst", "Scramble"].includes(fmt.name);
  const isBestBall = ["Best Ball", "Shamble"].includes(fmt.name);

  if (fmt.name === "Singles") {
    const [h, a] = normalizeToLowest([
      playingHandicap(hp1CH, pct, nineHole),
      playingHandicap(ap1CH, pct, nineHole),
    ]);
    homeP1Phcp = h;
    awayP1Phcp = a;

  } else if (isBestBall) {
    // All balls in one group, normalize to lowest
    type Entry = { side: "home" | "away"; slot: 1 | 2; ch: number };
    const entries: Entry[] = [{ side: "home", slot: 1, ch: hp1CH }];
    if (hp2CH !== null) entries.push({ side: "home", slot: 2, ch: hp2CH });
    entries.push({ side: "away", slot: 1, ch: ap1CH });
    if (ap2CH !== null) entries.push({ side: "away", slot: 2, ch: ap2CH });

    const normalized = normalizeToLowest(entries.map((e) => playingHandicap(e.ch, pct, nineHole)));
    const phcpFor = (side: "home" | "away", slot: 1 | 2) => {
      const idx = entries.findIndex((e) => e.side === side && e.slot === slot);
      return idx >= 0 ? normalized[idx] : null;
    };
    homeP1Phcp = phcpFor("home", 1) ?? 0;
    homeP2Phcp = phcpFor("home", 2);
    awayP1Phcp = phcpFor("away", 1) ?? 0;
    awayP2Phcp = phcpFor("away", 2);

  } else if (fmt.name === "Pinehurst") {
    const homeRaw = hp2CH !== null
      ? teamHandicap(playingHandicap(hp1CH, pct, nineHole), playingHandicap(hp2CH, pct, nineHole))
      : playingHandicap(hp1CH, pct, nineHole); // 2v1
    const awayRaw = ap2CH !== null
      ? teamHandicap(playingHandicap(ap1CH, pct, nineHole), playingHandicap(ap2CH, pct, nineHole))
      : playingHandicap(ap1CH, pct, nineHole);
    const { teamA, teamB } = twoTeamHandicaps(homeRaw, awayRaw);
    homeTeamPhcp = teamA;
    awayTeamPhcp = teamB;

  } else if (fmt.name === "Scramble") {
    const scrambleTeamHcp = (p1: number, p2: number | null) => {
      if (p2 === null) return playingHandicap(p1, 50, nineHole); // 2v1: 35+15 of own
      const [low, high] = p1 <= p2 ? [p1, p2] : [p2, p1];
      return teamHandicap(
        playingHandicap(low, pct, nineHole),
        playingHandicap(high, pct2, nineHole),
      );
    };
    const { teamA, teamB } = twoTeamHandicaps(
      scrambleTeamHcp(hp1CH, hp2CH),
      scrambleTeamHcp(ap1CH, ap2CH),
    );
    homeTeamPhcp = teamA;
    awayTeamPhcp = teamB;
  }

  // Existing scores
  const { data: scoresRaw } = await supabase
    .from("hole_scores")
    .select("hole_number, home_p1_gross, home_p2_gross, away_p1_gross, away_p2_gross")
    .eq("matchup_id", params.matchupId);
  const scoreMap: Record<number, ScoreRow> = {};
  for (const s of scoresRaw ?? []) scoreMap[s.hole_number] = s;

  // For 9-hole rounds, re-rank SIs 1–9 so stroke allocation is correct
  const allHoleSIs = holes.map((h) => h.stroke_index);
  const effectiveSI = (rawSI: number) =>
    nineHole ? nineHoleSIRank(rawSI, allHoleSIs) : rawSI;

  // Returns 0, 0.5, 1, or 2 strokes for a player on a hole
  const strokes = (phcp: number, rawSI: number) =>
    strokesGivenOnHole(phcp, effectiveSI(rawSI));

  // ── Per-hole result computation ─────────────────────────────────────────

  function computeHoleResult(s: ScoreRow | undefined, hole: HoleRow): HoleResult {
    if (!s) return null;
    const si = hole.stroke_index;

    if (isOneScore) {
      const hGross = s.home_p1_gross;
      const aGross = s.away_p1_gross;
      if (hGross == null || aGross == null) return null;
      const hNet = hGross - strokes(homeTeamPhcp ?? 0, si);
      const aNet = aGross - strokes(awayTeamPhcp ?? 0, si);
      return hNet < aNet ? "home" : aNet < hNet ? "away" : "halve";
    }

    if (fmt.name === "Singles") {
      const hGross = s.home_p1_gross;
      const aGross = s.away_p1_gross;
      if (hGross == null || aGross == null) return null;
      const hNet = hGross - strokes(homeP1Phcp, si);
      const aNet = aGross - strokes(awayP1Phcp, si);
      return hNet < aNet ? "home" : aNet < hNet ? "away" : "halve";
    }

    // Best Ball / Shamble
    const homeNets: number[] = [];
    if (s.home_p1_gross != null) homeNets.push(s.home_p1_gross - strokes(homeP1Phcp, si));
    if (s.home_p2_gross != null && homeP2Phcp != null)
      homeNets.push(s.home_p2_gross - strokes(homeP2Phcp, si));
    const awayNets: number[] = [];
    if (s.away_p1_gross != null) awayNets.push(s.away_p1_gross - strokes(awayP1Phcp, si));
    if (s.away_p2_gross != null && awayP2Phcp != null)
      awayNets.push(s.away_p2_gross - strokes(awayP2Phcp, si));

    if (homeNets.length === 0 || awayNets.length === 0) return null;
    const bestH = Math.min(...homeNets);
    const bestA = Math.min(...awayNets);
    return bestH < bestA ? "home" : bestA < bestH ? "away" : "halve";
  }

  // Running match score — results in hole order so closeout can be detected
  const orderedResults: HoleResult[] = holes.map((hole) =>
    computeHoleResult(scoreMap[hole.hole_number], hole),
  );
  let homeWon = 0, awayWon = 0, holesPlayed = 0;
  for (const result of orderedResults) {
    if (result !== null) {
      holesPlayed++;
      if (result === "home") homeWon++;
      else if (result === "away") awayWon++;
    }
  }
  const matchLabel = holesPlayed === 0
    ? null
    : matchScoreLabel(orderedResults, holes.length, homeLabel, awayLabel);

  const sideLabel: Record<string, string> = { front: "Front 9", back: "Back 9", full: "Full 18" };

  // ── Server action ────────────────────────────────────────────────────────

  async function saveScores(formData: FormData) {
    "use server";
    const supabase = createClient();
    const holeNums = (formData.get("hole_numbers") as string).split(",").map(Number);
    for (const n of holeNums) {
      const parse = (key: string) => {
        const v = formData.get(key) as string;
        return v !== "" ? parseInt(v) : null;
      };
      await supabase.from("hole_scores").upsert({
        matchup_id:    params.matchupId,
        hole_number:   n,
        home_p1_gross: parse(`hp1_${n}`),
        home_p2_gross: parse(`hp2_${n}`),
        away_p1_gross: parse(`ap1_${n}`),
        away_p2_gross: parse(`ap2_${n}`),
      }, { onConflict: "matchup_id,hole_number", ignoreDuplicates: false });
    }
    revalidatePath(`/admin/events/${params.id}/rounds/${params.roundId}/matchups/${params.matchupId}/scorecard`);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const resultIcon: Record<HoleResult & string, string> = {
    home: "H", away: "A", halve: "½",
  };

  const inputCls = "w-10 rounded border border-hairline px-1 py-1 text-center text-sm text-navy focus:border-navy focus:outline-none";

  return (
    <div className="px-4 py-6 space-y-4">
      <Link href={matchupsPath} className="text-sm text-navy/50 hover:text-navy">
        ← Matchups
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-xl font-display font-bold text-navy">
          Match {matchup.match_number} Scorecard
        </h1>
        <p className="text-xs text-navy/50 mt-0.5">
          {round.course_tees?.courses?.name} · {round.course_tees?.tee_name} Tees ·{" "}
          {sideLabel[round.side]} · {fmt.name}
        </p>
      </div>

      {/* Match score badge */}
      {matchLabel && (
        <div className="rounded-xl bg-navy px-4 py-3 text-center">
          <p className="text-white font-bold text-lg">{matchLabel}</p>
          <p className="text-white/60 text-xs mt-0.5">
            {homeLabel} {homeWon} · {awayWon} {awayLabel} · {holesPlayed} holes played
          </p>
        </div>
      )}

      {/* Handicap warning */}
      {missingHcps && (
        <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
          ⚠ Some players have no handicap for this tee set — showing 0. Go to the team roster and hit &ldquo;Calculate Handicaps&rdquo; first.
        </p>
      )}

      {/* Handicap breakdown */}
      <div className="rounded-xl border border-hairline bg-white divide-y divide-hairline text-xs">
        {/* Home team */}
        <div className="px-4 py-3 space-y-1">
          <p className="font-semibold text-navy flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: homeTeam?.color ?? "#ccc" }} />
            {homeLabel}
            {isOneScore
              ? ` — ${[matchup.home_p1?.display_name, matchup.home_p2?.display_name].filter(Boolean).join(" / ")}`
              : fmt.name === "Singles"
              ? ` — ${matchup.home_p1?.display_name}`
              : ` — ${[matchup.home_p1?.display_name, matchup.home_p2?.display_name].filter(Boolean).join(" / ")}`}
          </p>
          {isOneScore ? (
            <div className="text-navy/60 space-y-0.5">
              {matchup.home_p1 && (
                <p>
                  {matchup.home_p1.display_name}: course hcp {hp1CH}
                  {fmt.name === "Scramble"
                    ? ` × ${hp1CH <= (hp2CH ?? 999) ? pct : pct2}% (${hp1CH <= (hp2CH ?? 999) ? "low" : "high"}) = ${playingHandicap(hp1CH, hp1CH <= (hp2CH ?? 999) ? pct : pct2, nineHole)}`
                    : ` × ${pct}% = ${playingHandicap(hp1CH, pct, nineHole)}`}
                </p>
              )}
              {matchup.home_p2 && hp2CH !== null && (
                <p>
                  {matchup.home_p2.display_name}: course hcp {hp2CH}
                  {fmt.name === "Scramble"
                    ? ` × ${hp2CH < hp1CH ? pct : pct2}% (${hp2CH < hp1CH ? "low" : "high"}) = ${playingHandicap(hp2CH, hp2CH < hp1CH ? pct : pct2, nineHole)}`
                    : ` × ${pct}% = ${playingHandicap(hp2CH, pct, nineHole)}`}
                </p>
              )}
              <p className="font-semibold text-navy pt-0.5">
                Team playing hcp (normalized): {homeTeamPhcp ?? 0}
              </p>
            </div>
          ) : fmt.name === "Singles" ? (
            <p className="text-navy/60">
              {matchup.home_p1?.display_name}: course hcp {hp1CH} × {pct}% = playing hcp {homeP1Phcp}
            </p>
          ) : (
            <div className="text-navy/60 space-y-0.5">
              {matchup.home_p1 && <p>{matchup.home_p1.display_name}: course hcp {hp1CH} × {pct}% → playing hcp {homeP1Phcp}</p>}
              {matchup.home_p2 && homeP2Phcp != null && <p>{matchup.home_p2.display_name}: course hcp {hp2CH ?? 0} × {pct}% → playing hcp {homeP2Phcp}</p>}
            </div>
          )}
        </div>

        {/* Away team */}
        <div className="px-4 py-3 space-y-1">
          <p className="font-semibold text-navy flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: awayTeam?.color ?? "#ccc" }} />
            {awayLabel}
            {isOneScore
              ? ` — ${[matchup.away_p1?.display_name, matchup.away_p2?.display_name].filter(Boolean).join(" / ")}`
              : fmt.name === "Singles"
              ? ` — ${matchup.away_p1?.display_name}`
              : ` — ${[matchup.away_p1?.display_name, matchup.away_p2?.display_name].filter(Boolean).join(" / ")}`}
          </p>
          {isOneScore ? (
            <div className="text-navy/60 space-y-0.5">
              {matchup.away_p1 && (
                <p>
                  {matchup.away_p1.display_name}: course hcp {ap1CH}
                  {fmt.name === "Scramble"
                    ? ` × ${ap1CH <= (ap2CH ?? 999) ? pct : pct2}% (${ap1CH <= (ap2CH ?? 999) ? "low" : "high"}) = ${playingHandicap(ap1CH, ap1CH <= (ap2CH ?? 999) ? pct : pct2, nineHole)}`
                    : ` × ${pct}% = ${playingHandicap(ap1CH, pct, nineHole)}`}
                </p>
              )}
              {matchup.away_p2 && ap2CH !== null && (
                <p>
                  {matchup.away_p2.display_name}: course hcp {ap2CH}
                  {fmt.name === "Scramble"
                    ? ` × ${ap2CH < ap1CH ? pct : pct2}% (${ap2CH < ap1CH ? "low" : "high"}) = ${playingHandicap(ap2CH, ap2CH < ap1CH ? pct : pct2, nineHole)}`
                    : ` × ${pct}% = ${playingHandicap(ap2CH, pct, nineHole)}`}
                </p>
              )}
              <p className="font-semibold text-navy pt-0.5">
                Team playing hcp (normalized): {awayTeamPhcp ?? 0}
              </p>
            </div>
          ) : fmt.name === "Singles" ? (
            <p className="text-navy/60">
              {matchup.away_p1?.display_name}: course hcp {ap1CH} × {pct}% = playing hcp {awayP1Phcp}
            </p>
          ) : (
            <div className="text-navy/60 space-y-0.5">
              {matchup.away_p1 && <p>{matchup.away_p1.display_name}: course hcp {ap1CH} × {pct}% → playing hcp {awayP1Phcp}</p>}
              {matchup.away_p2 && awayP2Phcp != null && <p>{matchup.away_p2.display_name}: course hcp {ap2CH ?? 0} × {pct}% → playing hcp {awayP2Phcp}</p>}
            </div>
          )}
        </div>

        {/* Stroke key */}
        <div className="px-4 py-2 text-navy/40 flex gap-4">
          <span>● = full stroke</span>
          <span className="text-amber-500">½ = half stroke</span>
        </div>
      </div>

      {/* Scorecard form */}
      <form action={saveScores}>
        <input type="hidden" name="hole_numbers" value={holes.map((h) => h.hole_number).join(",")} />

        <div className="overflow-x-auto -mx-4 px-4">
          <table className="text-sm border-collapse min-w-full">
            <thead>
              <tr className="border-b-2 border-navy/20">
                <th className="text-left pr-2 py-2 text-xs font-semibold text-navy/50 w-8">Hole</th>
                <th className="text-center px-1 py-2 text-xs font-semibold text-navy/50 w-8">Par</th>
                <th className="text-center px-1 py-2 text-xs font-semibold text-navy/50 w-8">SI</th>

                {isOneScore ? (
                  <>
                    <th className="text-center px-2 py-2 text-xs font-semibold w-24"
                      style={{ color: homeTeam?.color ?? "#0C2D55" }}>
                      <div>{homeLabel}</div>
                      <div className="font-normal text-navy/50">
                        {[matchup.home_p1?.display_name, matchup.home_p2?.display_name].filter(Boolean).join(" / ")}
                      </div>
                    </th>
                    <th className="text-center px-2 py-2 text-xs font-semibold w-24"
                      style={{ color: awayTeam?.color ?? "#0C2D55" }}>
                      <div>{awayLabel}</div>
                      <div className="font-normal text-navy/50">
                        {[matchup.away_p1?.display_name, matchup.away_p2?.display_name].filter(Boolean).join(" / ")}
                      </div>
                    </th>
                  </>
                ) : fmt.name === "Singles" ? (
                  <>
                    <th className="text-center px-2 py-2 text-xs font-semibold w-24"
                      style={{ color: homeTeam?.color ?? "#0C2D55" }}>
                      <div>{homeLabel}</div>
                      <div className="font-normal text-navy/50">{matchup.home_p1?.display_name}</div>
                    </th>
                    <th className="text-center px-2 py-2 text-xs font-semibold w-24"
                      style={{ color: awayTeam?.color ?? "#0C2D55" }}>
                      <div>{awayLabel}</div>
                      <div className="font-normal text-navy/50">{matchup.away_p1?.display_name}</div>
                    </th>
                  </>
                ) : (
                  <>
                    <th className="text-center px-1 py-2 text-xs font-semibold w-20"
                      style={{ color: homeTeam?.color ?? "#0C2D55" }}>
                      <div>{matchup.home_p1?.display_name}</div>
                      <div className="font-normal opacity-60">{homeLabel} · {homeP1Phcp} hcp</div>
                    </th>
                    {matchup.home_p2 && (
                      <th className="text-center px-1 py-2 text-xs font-semibold w-20"
                        style={{ color: homeTeam?.color ?? "#0C2D55" }}>
                        <div>{matchup.home_p2.display_name}</div>
                        <div className="font-normal opacity-60">{homeLabel} · {homeP2Phcp ?? 0} hcp</div>
                      </th>
                    )}
                    <th className="text-center px-1 py-2 text-xs font-semibold w-20"
                      style={{ color: awayTeam?.color ?? "#0C2D55" }}>
                      <div>{matchup.away_p1?.display_name}</div>
                      <div className="font-normal opacity-60">{awayLabel} · {awayP1Phcp} hcp</div>
                    </th>
                    {matchup.away_p2 && (
                      <th className="text-center px-1 py-2 text-xs font-semibold w-20"
                        style={{ color: awayTeam?.color ?? "#0C2D55" }}>
                        <div>{matchup.away_p2.display_name}</div>
                        <div className="font-normal opacity-60">{awayLabel} · {awayP2Phcp ?? 0} hcp</div>
                      </th>
                    )}
                  </>
                )}
                <th className="text-center pl-2 py-2 text-xs font-semibold text-navy/50 w-8">Res</th>
              </tr>
            </thead>
            <tbody>
              {holes.map((hole) => {
                const s = scoreMap[hole.hole_number];
                const result = computeHoleResult(s, hole);
                const si = hole.stroke_index;

                // Net score display helper (uses effectiveSI for 9-hole re-ranking)
                const net = (gross: number | null | undefined, phcp: number) => {
                  if (gross == null) return null;
                  return gross - strokes(phcp, si);
                };

                const rowBg =
                  result === "home" ? "bg-blue-50"
                  : result === "away" ? "bg-red-50"
                  : result === "halve" ? "bg-gray-50"
                  : "";

                return (
                  <tr key={hole.hole_number} className={`border-b border-hairline ${rowBg}`}>
                    <td className="pr-2 py-2 font-semibold text-navy text-center">{hole.hole_number}</td>
                    <td className="px-1 py-2 text-navy/60 text-center">{hole.par}</td>
                    <td className="px-1 py-2 text-navy/40 text-center text-xs">{si}</td>

                    {isOneScore ? (
                      <>
                        {/* Home team gross + net */}
                        <td className="px-2 py-1">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex items-center gap-0.5">
                              <input name={`hp1_${hole.hole_number}`} type="number" min="1" max="15"
                                defaultValue={s?.home_p1_gross ?? ""} className={inputCls} />
                              {strokes(homeTeamPhcp ?? 0, si) === 0.5 && <span className="text-xs text-amber-500">½</span>}
                              {strokes(homeTeamPhcp ?? 0, si) >= 1 && <span className="text-xs text-navy/50">●</span>}
                            </div>
                            {net(s?.home_p1_gross, homeTeamPhcp ?? 0) != null && (
                              <span className="text-xs text-navy/50">{net(s?.home_p1_gross, homeTeamPhcp ?? 0)}</span>
                            )}
                          </div>
                        </td>
                        {/* Away team gross + net */}
                        <td className="px-2 py-1">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex items-center gap-0.5">
                              <input name={`ap1_${hole.hole_number}`} type="number" min="1" max="15"
                                defaultValue={s?.away_p1_gross ?? ""} className={inputCls} />
                              {strokes(awayTeamPhcp ?? 0, si) === 0.5 && <span className="text-xs text-amber-500">½</span>}
                              {strokes(awayTeamPhcp ?? 0, si) >= 1 && <span className="text-xs text-navy/50">●</span>}
                            </div>
                            {net(s?.away_p1_gross, awayTeamPhcp ?? 0) != null && (
                              <span className="text-xs text-navy/50">{net(s?.away_p1_gross, awayTeamPhcp ?? 0)}</span>
                            )}
                          </div>
                        </td>
                      </>
                    ) : fmt.name === "Singles" ? (
                      <>
                        <td className="px-2 py-1">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex items-center gap-0.5">
                              <input name={`hp1_${hole.hole_number}`} type="number" min="1" max="15"
                                defaultValue={s?.home_p1_gross ?? ""} className={inputCls} />
                              {strokes(homeP1Phcp, si) === 0.5 && <span className="text-xs text-amber-500">½</span>}
                              {strokes(homeP1Phcp, si) >= 1 && <span className="text-xs text-navy/50">●</span>}
                            </div>
                            {net(s?.home_p1_gross, homeP1Phcp) != null && (
                              <span className="text-xs text-navy/50">{net(s?.home_p1_gross, homeP1Phcp)}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex items-center gap-0.5">
                              <input name={`ap1_${hole.hole_number}`} type="number" min="1" max="15"
                                defaultValue={s?.away_p1_gross ?? ""} className={inputCls} />
                              {strokes(awayP1Phcp, si) === 0.5 && <span className="text-xs text-amber-500">½</span>}
                              {strokes(awayP1Phcp, si) >= 1 && <span className="text-xs text-navy/50">●</span>}
                            </div>
                            {net(s?.away_p1_gross, awayP1Phcp) != null && (
                              <span className="text-xs text-navy/50">{net(s?.away_p1_gross, awayP1Phcp)}</span>
                            )}
                          </div>
                        </td>
                      </>
                    ) : (
                      /* Best Ball / Shamble */
                      <>
                        <td className="px-1 py-1">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex items-center gap-0.5">
                              <input name={`hp1_${hole.hole_number}`} type="number" min="1" max="15"
                                defaultValue={s?.home_p1_gross ?? ""} className={inputCls} />
                              {strokes(homeP1Phcp, si) === 0.5 && <span className="text-xs text-amber-500">½</span>}
                              {strokes(homeP1Phcp, si) >= 1 && <span className="text-xs text-navy/50">●</span>}
                            </div>
                            {net(s?.home_p1_gross, homeP1Phcp) != null && (
                              <span className="text-xs text-navy/50">{net(s?.home_p1_gross, homeP1Phcp)}</span>
                            )}
                          </div>
                        </td>
                        {matchup.home_p2 && (
                          <td className="px-1 py-1">
                            <div className="flex flex-col items-center gap-0.5">
                              <div className="flex items-center gap-0.5">
                                <input name={`hp2_${hole.hole_number}`} type="number" min="1" max="15"
                                  defaultValue={s?.home_p2_gross ?? ""} className={inputCls} />
                                {homeP2Phcp != null && strokes(homeP2Phcp, si) === 0.5 && <span className="text-xs text-amber-500">½</span>}
                                {homeP2Phcp != null && strokes(homeP2Phcp, si) >= 1 && <span className="text-xs text-navy/50">●</span>}
                              </div>
                              {homeP2Phcp != null && net(s?.home_p2_gross, homeP2Phcp) != null && (
                                <span className="text-xs text-navy/50">{net(s?.home_p2_gross, homeP2Phcp)}</span>
                              )}
                            </div>
                          </td>
                        )}
                        <td className="px-1 py-1">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex items-center gap-0.5">
                              <input name={`ap1_${hole.hole_number}`} type="number" min="1" max="15"
                                defaultValue={s?.away_p1_gross ?? ""} className={inputCls} />
                              {strokes(awayP1Phcp, si) === 0.5 && <span className="text-xs text-amber-500">½</span>}
                              {strokes(awayP1Phcp, si) >= 1 && <span className="text-xs text-navy/50">●</span>}
                            </div>
                            {net(s?.away_p1_gross, awayP1Phcp) != null && (
                              <span className="text-xs text-navy/50">{net(s?.away_p1_gross, awayP1Phcp)}</span>
                            )}
                          </div>
                        </td>
                        {matchup.away_p2 && (
                          <td className="px-1 py-1">
                            <div className="flex flex-col items-center gap-0.5">
                              <div className="flex items-center gap-0.5">
                                <input name={`ap2_${hole.hole_number}`} type="number" min="1" max="15"
                                  defaultValue={s?.away_p2_gross ?? ""} className={inputCls} />
                                {awayP2Phcp != null && strokes(awayP2Phcp, si) === 0.5 && <span className="text-xs text-amber-500">½</span>}
                                {awayP2Phcp != null && strokes(awayP2Phcp, si) >= 1 && <span className="text-xs text-navy/50">●</span>}
                              </div>
                              {awayP2Phcp != null && net(s?.away_p2_gross, awayP2Phcp) != null && (
                                <span className="text-xs text-navy/50">{net(s?.away_p2_gross, awayP2Phcp)}</span>
                              )}
                            </div>
                          </td>
                        )}
                      </>
                    )}

                    {/* Hole result */}
                    <td className="pl-2 py-2 text-center font-semibold text-sm">
                      {result ? (
                        <span className={
                          result === "home" ? "text-blue-600"
                          : result === "away" ? "text-red-600"
                          : "text-navy/40"
                        }>
                          {resultIcon[result]}
                        </span>
                      ) : (
                        <span className="text-navy/20">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Totals row */}
            {holesPlayed > 0 && (
              <tfoot>
                <tr className="border-t-2 border-navy/20">
                  <td colSpan={3} className="py-2 pr-2 text-xs font-semibold text-navy/50 uppercase tracking-wide">
                    Holes won
                  </td>
                  {isOneScore || fmt.name === "Singles" ? (
                    <>
                      <td className="text-center py-2 font-bold text-navy">{homeWon}</td>
                      <td className="text-center py-2 font-bold text-navy">{awayWon}</td>
                    </>
                  ) : (
                    <>
                      <td className="text-center py-2 font-bold text-navy" colSpan={matchup.home_p2 ? 2 : 1}>{homeWon}</td>
                      <td className="text-center py-2 font-bold text-navy" colSpan={matchup.away_p2 ? 2 : 1}>{awayWon}</td>
                    </>
                  )}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <button type="submit"
          className="mt-4 w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
          Save Scores
        </button>
      </form>
    </div>
  );
}
