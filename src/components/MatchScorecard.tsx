import { createClient } from "@/lib/supabase/server";
import { isAdmin, type Player } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { roundToHalf } from "@/lib/handicap";
import {
  computePlayingHcps,
  computeHoleResults,
  strokesOnHole,
  isOneScoreFormat,
  type GrossScores,
} from "@/lib/matchcalc";
import { matchOutcome, outcomeBadge } from "@/lib/matchplay";
import { ScoreInput } from "@/components/ScoreInput";

// ── Types ────────────────────────────────────────────────────────────────────

type EPRef = { id: string; display_name: string; player_id: string | null } | null;
type HoleRow = { hole_number: number; par: number; stroke_index: number };
type ScoreRow = GrossScores & { hole_number: number };

// ── Helpers ──────────────────────────────────────────────────────────────────

function holeNums(side: string): number[] {
  if (side === "front") return Array.from({ length: 9 }, (_, i) => i + 1);
  if (side === "back")  return Array.from({ length: 9 }, (_, i) => i + 10);
  return Array.from({ length: 18 }, (_, i) => i + 1);
}

/** Upsert the grid of gross scores from the scorecard form. */
async function upsertHoleScores(
  supabase: ReturnType<typeof createClient>,
  matchupId: string,
  formData: FormData,
) {
  const nums = (formData.get("hole_numbers") as string).split(",").map(Number);
  for (const n of nums) {
    const parse = (key: string) => {
      const v = formData.get(key) as string;
      return v !== "" ? parseInt(v) : null;
    };
    await supabase.from("hole_scores").upsert({
      matchup_id:    matchupId,
      hole_number:   n,
      home_p1_gross: parse(`hp1_${n}`),
      home_p2_gross: parse(`hp2_${n}`),
      away_p1_gross: parse(`ap1_${n}`),
      away_p2_gross: parse(`ap2_${n}`),
    }, { onConflict: "matchup_id,hole_number", ignoreDuplicates: false });
  }
}

/**
 * Server-side authorization for scoring actions: admins/assistants, or any
 * player who is IN the match (the architecture's scoring exception).
 * Mirrors the RLS policy; throws if not allowed.
 */
async function assertCanScore(matchupId: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: player } = await supabase
    .from("players").select("id, role").eq("auth_user_id", user.id).single();
  if (!player) redirect("/login");
  if (player.role === "admin" || player.role === "assistant") return;

  const { data: m } = await supabase
    .from("matchups")
    .select("home_p1_id, home_p2_id, away_p1_id, away_p2_id")
    .eq("id", matchupId)
    .single();
  const epIds = [m?.home_p1_id, m?.home_p2_id, m?.away_p1_id, m?.away_p2_id].filter(Boolean) as string[];
  if (epIds.length === 0) throw new Error("Not authorized to score this match");

  const { data: eps } = await supabase
    .from("event_participants").select("player_id").in("id", epIds);
  if (!eps?.some((ep) => ep.player_id === player.id)) {
    throw new Error("Not authorized to score this match");
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export async function MatchScorecard({
  matchupId,
  currentPath,
  backHref,
  backLabel,
  viewer,
  reviewing: reviewRequested,
}: {
  matchupId: string;
  currentPath: string;
  backHref: string;
  backLabel: string;
  viewer: Player;
  reviewing: boolean;
}) {
  const supabase = createClient();

  // Matchup (first, so we can derive round + event from it)
  const { data: matchupRaw } = await supabase
    .from("matchups")
    .select(`
      id, round_id, match_number, status, result, match_score,
      home_p1:event_participants!matchups_home_p1_id_fkey(id, display_name, player_id),
      home_p2:event_participants!matchups_home_p2_id_fkey(id, display_name, player_id),
      away_p1:event_participants!matchups_away_p1_id_fkey(id, display_name, player_id),
      away_p2:event_participants!matchups_away_p2_id_fkey(id, display_name, player_id)
    `)
    .eq("id", matchupId)
    .single();
  const matchup = matchupRaw as unknown as {
    id: string; round_id: string; match_number: number; status: string;
    result: string | null; match_score: string | null;
    home_p1: EPRef; home_p2: EPRef; away_p1: EPRef; away_p2: EPRef;
  } | null;
  if (!matchup) redirect(backHref);

  // Round
  const { data: roundRaw } = await supabase
    .from("rounds")
    .select("id, event_id, round_number, name, side, course_tee_id, formats(id, name, hcp_allowance, hcp_allowance_secondary), course_tees(tee_name, courses(name))")
    .eq("id", matchup.round_id)
    .single();
  const round = roundRaw as unknown as {
    id: string; event_id: string; round_number: number; name: string | null; side: string; course_tee_id: string;
    formats: { id: string; name: string; hcp_allowance: number; hcp_allowance_secondary: number | null } | null;
    course_tees: { tee_name: string; courses: { name: string } | null } | null;
  } | null;
  if (!round?.formats) redirect(backHref);

  const fmt = round.formats!;
  const eventId = round.event_id;
  const nineHole = round.side !== "full";
  const pct  = fmt.hcp_allowance;
  const pct2 = fmt.hcp_allowance_secondary ?? 0;
  const isOneScore = isOneScoreFormat(fmt.name);

  // Can this viewer enter scores? Admin/assistant, or a player in the match.
  const participantPlayerIds = [
    matchup.home_p1?.player_id, matchup.home_p2?.player_id,
    matchup.away_p1?.player_id, matchup.away_p2?.player_id,
  ].filter(Boolean) as string[];
  const canScore = isAdmin(viewer) || participantPlayerIds.includes(viewer.id);
  const reviewing = reviewRequested && canScore;

  // Teams for display labels
  const { data: teams } = await supabase
    .from("teams").select("id, name, color").eq("event_id", eventId).order("name");
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
  const allHoleSIs = holes.map((h) => h.stroke_index);

  // Participant handicaps
  const { data: hcpRows } = await supabase
    .from("participant_handicaps")
    .select("player_id, calculated_hcp, override_hcp")
    .eq("event_id", eventId)
    .eq("course_tee_id", round.course_tee_id)
    .in("player_id", participantPlayerIds.length > 0 ? participantPlayerIds : ["00000000-0000-0000-0000-000000000000"]);

  const effectiveHcp = (pid: string | null | undefined): number => {
    if (!pid) return 0;
    const row = hcpRows?.find((h) => h.player_id === pid);
    return row?.override_hcp ?? row?.calculated_hcp ?? 0;
  };
  const missingHcps = participantPlayerIds.some((pid) => !hcpRows?.find((h) => h.player_id === pid));

  // Course hcps per player
  const hp1CH = effectiveHcp(matchup.home_p1?.player_id);
  const hp2CH = matchup.home_p2 ? effectiveHcp(matchup.home_p2.player_id) : null;
  const ap1CH = effectiveHcp(matchup.away_p1?.player_id);
  const ap2CH = matchup.away_p2 ? effectiveHcp(matchup.away_p2.player_id) : null;

  // Playing handicaps by format (shared engine)
  const phcps = computePlayingHcps(fmt, {
    homeP1: hp1CH, homeP2: hp2CH, awayP1: ap1CH, awayP2: ap2CH,
  }, nineHole);
  const homeP1Phcp = phcps.homeP1;
  const homeP2Phcp = phcps.homeP2;
  const awayP1Phcp = phcps.awayP1;
  const awayP2Phcp = phcps.awayP2;
  const homeTeamPhcp = phcps.homeTeam;
  const awayTeamPhcp = phcps.awayTeam;

  // Existing scores
  const { data: scoresRaw } = await supabase
    .from("hole_scores")
    .select("hole_number, home_p1_gross, home_p2_gross, away_p1_gross, away_p2_gross")
    .eq("matchup_id", matchupId);
  const scoreMap: Record<number, ScoreRow> = {};
  for (const s of scoresRaw ?? []) scoreMap[s.hole_number] = s;

  const strokes = (phcp: number, rawSI: number) =>
    strokesOnHole(phcp, rawSI, allHoleSIs, nineHole);

  // Stroke indicator: one ● per full stroke, ½ suffix for a half stroke.
  const strokeMarks = (phcp: number, rawSI: number) => {
    const s = strokes(phcp, rawSI);
    if (s <= 0) return null;
    const dots = Math.floor(s);
    return (
      <>
        {dots > 0 && <span className="text-xs text-navy/50">{"●".repeat(dots)}</span>}
        {s % 1 > 0 && <span className="text-xs text-amber-500">½</span>}
      </>
    );
  };

  // Running match score — results in hole order so closeout can be detected
  const orderedResults = computeHoleResults(fmt, phcps, scoreMap, holes, nineHole);
  const outcome = matchOutcome(orderedResults, holes.length);
  const { homeWon, awayWon, holesPlayed } = outcome;
  const matchLabel = outcomeBadge(outcome, homeLabel, awayLabel);

  const sideLabel: Record<string, string> = { front: "Front 9", back: "Back 9", full: "Full 18" };

  // ── Server actions ─────────────────────────────────────────────────────────

  async function saveScores(formData: FormData) {
    "use server";
    await assertCanScore(matchupId);
    await upsertHoleScores(createClient(), matchupId, formData);
    revalidatePath(currentPath);
    revalidatePath("/live");
  }

  // Save progress, then go to the dedicated review screen.
  async function saveAndReview(formData: FormData) {
    "use server";
    await assertCanScore(matchupId);
    await upsertHoleScores(createClient(), matchupId, formData);
    revalidatePath(currentPath);
    revalidatePath("/live");
    redirect(`${currentPath}?review=1`);
  }

  // Confirm from the review screen: write the derived status/result/score.
  async function completeMatch(formData: FormData) {
    "use server";
    await assertCanScore(matchupId);
    const supabase = createClient();
    const result = (formData.get("result") as string) || null;
    const score  = (formData.get("match_score") as string) || null;
    await supabase.from("matchups").update({
      status:      "complete",
      result,
      match_score: score,
    }).eq("id", matchupId);
    revalidatePath(backHref);
    revalidatePath("/live");
    redirect(backHref);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  // Spell out every step of the playing-hcp math, mirroring playingHandicap():
  // course → (9-hole ÷2) → × format % → rounded to 0.5
  const fmtNum = (n: number) => `${Math.round(n * 100) / 100}`;
  const hcpChain = (courseHcp: number, pctUsed: number, tag?: string) => {
    const base = nineHole ? courseHcp / 2 : courseHcp;
    const raw = base * (pctUsed / 100);
    const rounded = roundToHalf(raw);
    const pctLabel = tag ? `× ${pctUsed}% (${tag})` : `× ${pctUsed}%`;
    return [
      `course ${fmtNum(courseHcp)}`,
      ...(nineHole ? [`9-hole ${fmtNum(courseHcp / 2)}`] : []),
      `${pctLabel} = ${fmtNum(raw)}`,
      `rounds to ${fmtNum(rounded)}`,
    ].join(" → ");
  };

  // Res column: team abbreviation + color dot instead of generic H/A
  const abbrev = (name: string) => name.slice(0, 3).toUpperCase();
  const resultCell: Record<"home" | "away" | "halve", { label: string; color: string | null }> = {
    home:  { label: abbrev(homeLabel), color: homeTeam?.color ?? null },
    away:  { label: abbrev(awayLabel), color: awayTeam?.color ?? null },
    halve: { label: "½", color: null },
  };

  return (
    <div className="px-4 py-6 space-y-4">
      <Link href={backHref} className="text-sm text-navy/50 hover:text-navy">
        ← {backLabel}
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

      {/* Dedicated review + confirm screen */}
      {reviewing && holesPlayed > 0 && (
        <div className="space-y-4">
          <div className="rounded-xl bg-navy px-4 py-4 text-center">
            <p className="text-white/60 text-xs uppercase tracking-wide">Review — Match {matchup.match_number}</p>
            <p className="text-white font-bold text-2xl mt-1">{matchLabel}</p>
            <p className="text-white/60 text-xs mt-1">
              {homeLabel} {homeWon} · {awayWon} {awayLabel} · {holesPlayed} of {holes.length} holes
            </p>
          </div>

          {!outcome.decided && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              ⚠ This match isn&rsquo;t mathematically decided yet ({outcome.remaining} hole{outcome.remaining === 1 ? "" : "s"} without a score). You can still complete it using the current standing.
            </p>
          )}

          <div className="rounded-xl border border-hairline bg-white px-4 py-3 text-sm space-y-1">
            <p className="text-navy/70">Completing this match will set:</p>
            <ul className="text-navy/60 space-y-0.5 pl-4 list-disc">
              <li>Status → <span className="font-semibold text-navy">Complete</span></li>
              <li>Result → <span className="font-semibold text-navy">
                {outcome.result === "halve" ? "Halved" : `${outcome.result === "home" ? homeLabel : awayLabel} wins`}
              </span></li>
              <li>Match score → <span className="font-semibold text-navy">{outcome.score}</span></li>
            </ul>
          </div>

          <form action={completeMatch}>
            <input type="hidden" name="result" value={outcome.result ?? ""} />
            <input type="hidden" name="match_score" value={outcome.score ?? ""} />
            <button type="submit" className="w-full rounded-lg bg-europe-green py-2.5 text-sm font-semibold text-white">
              Confirm &amp; Complete Match
            </button>
          </form>
          <Link href={currentPath} className="block text-center text-sm text-navy/50 hover:text-navy">
            ← Back to scorecard
          </Link>
        </div>
      )}

    {!reviewing && (
      <>
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
                  {matchup.home_p1.display_name}:{" "}
                  {fmt.name === "Scramble"
                    ? hcpChain(hp1CH, hp1CH <= (hp2CH ?? 999) ? pct : pct2, hp1CH <= (hp2CH ?? 999) ? "low" : "high")
                    : hcpChain(hp1CH, pct)}
                </p>
              )}
              {matchup.home_p2 && hp2CH !== null && (
                <p>
                  {matchup.home_p2.display_name}:{" "}
                  {fmt.name === "Scramble"
                    ? hcpChain(hp2CH, hp2CH < hp1CH ? pct : pct2, hp2CH < hp1CH ? "low" : "high")
                    : hcpChain(hp2CH, pct)}
                </p>
              )}
              <p className="font-semibold text-navy pt-0.5">
                Team playing hcp (normalized): {homeTeamPhcp ?? 0}
              </p>
            </div>
          ) : fmt.name === "Singles" ? (
            <p className="text-navy/60">
              {matchup.home_p1?.display_name}: {hcpChain(hp1CH, pct)} → plays {homeP1Phcp} (normalized)
            </p>
          ) : (
            <div className="text-navy/60 space-y-0.5">
              {matchup.home_p1 && <p>{matchup.home_p1.display_name}: {hcpChain(hp1CH, pct)} → plays {homeP1Phcp} (normalized)</p>}
              {matchup.home_p2 && homeP2Phcp != null && <p>{matchup.home_p2.display_name}: {hcpChain(hp2CH ?? 0, pct)} → plays {homeP2Phcp} (normalized)</p>}
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
                  {matchup.away_p1.display_name}:{" "}
                  {fmt.name === "Scramble"
                    ? hcpChain(ap1CH, ap1CH <= (ap2CH ?? 999) ? pct : pct2, ap1CH <= (ap2CH ?? 999) ? "low" : "high")
                    : hcpChain(ap1CH, pct)}
                </p>
              )}
              {matchup.away_p2 && ap2CH !== null && (
                <p>
                  {matchup.away_p2.display_name}:{" "}
                  {fmt.name === "Scramble"
                    ? hcpChain(ap2CH, ap2CH < ap1CH ? pct : pct2, ap2CH < ap1CH ? "low" : "high")
                    : hcpChain(ap2CH, pct)}
                </p>
              )}
              <p className="font-semibold text-navy pt-0.5">
                Team playing hcp (normalized): {awayTeamPhcp ?? 0}
              </p>
            </div>
          ) : fmt.name === "Singles" ? (
            <p className="text-navy/60">
              {matchup.away_p1?.display_name}: {hcpChain(ap1CH, pct)} → plays {awayP1Phcp} (normalized)
            </p>
          ) : (
            <div className="text-navy/60 space-y-0.5">
              {matchup.away_p1 && <p>{matchup.away_p1.display_name}: {hcpChain(ap1CH, pct)} → plays {awayP1Phcp} (normalized)</p>}
              {matchup.away_p2 && awayP2Phcp != null && <p>{matchup.away_p2.display_name}: {hcpChain(ap2CH ?? 0, pct)} → plays {awayP2Phcp} (normalized)</p>}
            </div>
          )}
        </div>

        {/* Stroke key */}
        <div className="px-4 py-2 text-navy/40 flex gap-4">
          <span>● = full stroke</span>
          <span>●● = 2 strokes</span>
          <span className="text-amber-500">½ = half stroke</span>
        </div>
      </div>

      {/* Scorecard form */}
      <form>
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
                <th className="text-center pl-2 py-2 text-xs font-semibold text-navy/50 w-12">Res</th>
              </tr>
            </thead>
            <tbody>
              {holes.map((hole, holeIdx) => {
                const s = scoreMap[hole.hole_number];
                const result = orderedResults[holeIdx];
                const si = hole.stroke_index;

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
                              <ScoreInput key={`hp1_${hole.hole_number}_${s?.home_p1_gross ?? ""}`}
                                name={`hp1_${hole.hole_number}`} defaultValue={s?.home_p1_gross ?? null}
                                par={hole.par} disabled={!canScore}
                                sheetLabel={`Hole ${hole.hole_number} · Par ${hole.par} — ${homeLabel}`} />
                              {strokeMarks(homeTeamPhcp ?? 0, si)}
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
                              <ScoreInput key={`ap1_${hole.hole_number}_${s?.away_p1_gross ?? ""}`}
                                name={`ap1_${hole.hole_number}`} defaultValue={s?.away_p1_gross ?? null}
                                par={hole.par} disabled={!canScore}
                                sheetLabel={`Hole ${hole.hole_number} · Par ${hole.par} — ${awayLabel}`} />
                              {strokeMarks(awayTeamPhcp ?? 0, si)}
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
                              <ScoreInput key={`hp1_${hole.hole_number}_${s?.home_p1_gross ?? ""}`}
                                name={`hp1_${hole.hole_number}`} defaultValue={s?.home_p1_gross ?? null}
                                par={hole.par} disabled={!canScore}
                                sheetLabel={`Hole ${hole.hole_number} · Par ${hole.par} — ${matchup.home_p1?.display_name ?? homeLabel}`} />
                              {strokeMarks(homeP1Phcp, si)}
                            </div>
                            {net(s?.home_p1_gross, homeP1Phcp) != null && (
                              <span className="text-xs text-navy/50">{net(s?.home_p1_gross, homeP1Phcp)}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex items-center gap-0.5">
                              <ScoreInput key={`ap1_${hole.hole_number}_${s?.away_p1_gross ?? ""}`}
                                name={`ap1_${hole.hole_number}`} defaultValue={s?.away_p1_gross ?? null}
                                par={hole.par} disabled={!canScore}
                                sheetLabel={`Hole ${hole.hole_number} · Par ${hole.par} — ${matchup.away_p1?.display_name ?? awayLabel}`} />
                              {strokeMarks(awayP1Phcp, si)}
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
                              <ScoreInput key={`hp1_${hole.hole_number}_${s?.home_p1_gross ?? ""}`}
                                name={`hp1_${hole.hole_number}`} defaultValue={s?.home_p1_gross ?? null}
                                par={hole.par} disabled={!canScore}
                                sheetLabel={`Hole ${hole.hole_number} · Par ${hole.par} — ${matchup.home_p1?.display_name ?? homeLabel}`} />
                              {strokeMarks(homeP1Phcp, si)}
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
                                <ScoreInput key={`hp2_${hole.hole_number}_${s?.home_p2_gross ?? ""}`}
                                  name={`hp2_${hole.hole_number}`} defaultValue={s?.home_p2_gross ?? null}
                                  par={hole.par} disabled={!canScore}
                                  sheetLabel={`Hole ${hole.hole_number} · Par ${hole.par} — ${matchup.home_p2.display_name}`} />
                                {homeP2Phcp != null && strokeMarks(homeP2Phcp, si)}
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
                              <ScoreInput key={`ap1_${hole.hole_number}_${s?.away_p1_gross ?? ""}`}
                                name={`ap1_${hole.hole_number}`} defaultValue={s?.away_p1_gross ?? null}
                                par={hole.par} disabled={!canScore}
                                sheetLabel={`Hole ${hole.hole_number} · Par ${hole.par} — ${matchup.away_p1?.display_name ?? awayLabel}`} />
                              {strokeMarks(awayP1Phcp, si)}
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
                                <ScoreInput key={`ap2_${hole.hole_number}_${s?.away_p2_gross ?? ""}`}
                                  name={`ap2_${hole.hole_number}`} defaultValue={s?.away_p2_gross ?? null}
                                  par={hole.par} disabled={!canScore}
                                  sheetLabel={`Hole ${hole.hole_number} · Par ${hole.par} — ${matchup.away_p2.display_name}`} />
                                {awayP2Phcp != null && strokeMarks(awayP2Phcp, si)}
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
                    <td className="pl-2 py-2 text-center font-semibold text-xs">
                      {result ? (
                        result === "halve" ? (
                          <span className="text-navy/40 text-sm">½</span>
                        ) : (
                          <span className="inline-flex items-center gap-1"
                            style={{ color: resultCell[result].color ?? "#0C2D55" }}>
                            <span className="inline-block w-2 h-2 rounded-full"
                              style={{ backgroundColor: resultCell[result].color ?? "#0C2D55" }} />
                            {resultCell[result].label}
                          </span>
                        )
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

        {canScore ? (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button type="submit" formAction={saveScores}
              className="w-full rounded-lg border border-navy bg-white py-2 text-sm font-semibold text-navy">
              Save Progress
            </button>
            <button type="submit" formAction={saveAndReview}
              className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
              Save &amp; Review →
            </button>
          </div>
        ) : (
          <p className="mt-4 text-center text-xs text-navy/40">
            View only — players in this match can enter scores.
          </p>
        )}
      </form>
      </>
    )}
    </div>
  );
}
