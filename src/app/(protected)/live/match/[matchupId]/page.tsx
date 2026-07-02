import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { MatchScorecard } from "@/components/MatchScorecard";
import { LiveRefresher } from "@/components/LiveRefresher";
import { HoleByHole, type HbhHole, type HbhSlot } from "@/components/HoleByHole";
import { assertCanScore, upsertSingleScore, type SlotKey } from "@/lib/scoring";
import { computePlayingHcps, strokesOnHole, isOneScoreFormat } from "@/lib/matchcalc";

type EPRef = { id: string; display_name: string; player_id: string | null } | null;

function holeNums(side: string): number[] {
  if (side === "front") return Array.from({ length: 9 }, (_, i) => i + 1);
  if (side === "back")  return Array.from({ length: 9 }, (_, i) => i + 10);
  return Array.from({ length: 18 }, (_, i) => i + 1);
}

// Player-facing match page. Default: mobile hole-by-hole scorer.
// ?view=card (and the review/complete flow) renders the full scorecard.
export default async function LiveMatchPage({
  params,
  searchParams,
}: {
  params: { matchupId: string };
  searchParams: { review?: string; view?: string };
}) {
  const player = await requirePlayer();
  const currentPath = `/live/match/${params.matchupId}`;

  const wantsCard = searchParams.view === "card" || searchParams.review === "1";
  if (wantsCard) {
    return (
      <>
        <LiveRefresher matchupId={params.matchupId} />
        <MatchScorecard
          matchupId={params.matchupId}
          currentPath={currentPath}
          backHref="/live"
          backLabel="Live Scoreboard"
          viewer={player}
          reviewing={searchParams.review === "1"}
          defaultHcpOpen={false}
          reviewHref={`${currentPath}?view=card&review=1`}
          cardHref={`${currentPath}?view=card`}
        />
      </>
    );
  }

  // ── Hole-by-hole data ──────────────────────────────────────────────────────

  const supabase = createClient();

  const { data: matchupRaw } = await supabase
    .from("matchups")
    .select(`
      id, round_id, match_number,
      home_p1:event_participants!matchups_home_p1_id_fkey(id, display_name, player_id),
      home_p2:event_participants!matchups_home_p2_id_fkey(id, display_name, player_id),
      away_p1:event_participants!matchups_away_p1_id_fkey(id, display_name, player_id),
      away_p2:event_participants!matchups_away_p2_id_fkey(id, display_name, player_id)
    `)
    .eq("id", params.matchupId)
    .single();
  const matchup = matchupRaw as unknown as {
    id: string; round_id: string; match_number: number;
    home_p1: EPRef; home_p2: EPRef; away_p1: EPRef; away_p2: EPRef;
  } | null;
  if (!matchup) redirect("/live");

  const { data: roundRaw } = await supabase
    .from("rounds")
    .select("id, event_id, side, course_tee_id, formats(name, hcp_allowance, hcp_allowance_secondary)")
    .eq("id", matchup.round_id)
    .single();
  const round = roundRaw as unknown as {
    id: string; event_id: string; side: string; course_tee_id: string;
    formats: { name: string; hcp_allowance: number; hcp_allowance_secondary: number | null } | null;
  } | null;
  if (!round?.formats) redirect("/live");

  const fmt = round.formats!;
  const nineHole = round.side !== "full";

  const { data: teams } = await supabase
    .from("teams").select("id, name, color").eq("event_id", round.event_id).order("name");
  const homeTeam = teams?.[0];
  const awayTeam = teams?.[1];
  const homeLabel = homeTeam?.name ?? "Home";
  const awayLabel = awayTeam?.name ?? "Away";

  const relevant = holeNums(round.side);
  const { data: holesRaw } = await supabase
    .from("holes")
    .select("hole_number, par, stroke_index")
    .eq("course_tee_id", round.course_tee_id)
    .in("hole_number", relevant)
    .order("hole_number");
  const holeRows = holesRaw ?? [];
  const allHoleSIs = holeRows.map((h) => h.stroke_index);

  const participantPlayerIds = [
    matchup.home_p1?.player_id, matchup.home_p2?.player_id,
    matchup.away_p1?.player_id, matchup.away_p2?.player_id,
  ].filter(Boolean) as string[];
  const canScore = isAdmin(player) || participantPlayerIds.includes(player.id);

  const { data: hcpRows } = await supabase
    .from("participant_handicaps")
    .select("player_id, calculated_hcp, override_hcp")
    .eq("event_id", round.event_id)
    .eq("course_tee_id", round.course_tee_id)
    .in("player_id", participantPlayerIds.length > 0 ? participantPlayerIds : ["00000000-0000-0000-0000-000000000000"]);
  const effectiveHcp = (pid: string | null | undefined): number => {
    if (!pid) return 0;
    const row = hcpRows?.find((h) => h.player_id === pid);
    return row?.override_hcp ?? row?.calculated_hcp ?? 0;
  };

  const phcps = computePlayingHcps(fmt, {
    homeP1: effectiveHcp(matchup.home_p1?.player_id),
    homeP2: matchup.home_p2 ? effectiveHcp(matchup.home_p2.player_id) : null,
    awayP1: effectiveHcp(matchup.away_p1?.player_id),
    awayP2: matchup.away_p2 ? effectiveHcp(matchup.away_p2.player_id) : null,
  }, nineHole);

  // Slots by format: one score per team, or one per ball
  const slots: HbhSlot[] = [];
  const slotPhcp: Partial<Record<SlotKey, number>> = {};
  if (isOneScoreFormat(fmt.name)) {
    slots.push({
      key: "hp1", side: "home", label: homeLabel,
      sub: [matchup.home_p1?.display_name, matchup.home_p2?.display_name].filter(Boolean).join(" / ") || null,
    });
    slots.push({
      key: "ap1", side: "away", label: awayLabel,
      sub: [matchup.away_p1?.display_name, matchup.away_p2?.display_name].filter(Boolean).join(" / ") || null,
    });
    slotPhcp.hp1 = phcps.homeTeam ?? 0;
    slotPhcp.ap1 = phcps.awayTeam ?? 0;
  } else if (fmt.name === "Singles") {
    slots.push({ key: "hp1", side: "home", label: matchup.home_p1?.display_name ?? homeLabel, sub: homeLabel });
    slots.push({ key: "ap1", side: "away", label: matchup.away_p1?.display_name ?? awayLabel, sub: awayLabel });
    slotPhcp.hp1 = phcps.homeP1;
    slotPhcp.ap1 = phcps.awayP1;
  } else {
    // Best Ball / Shamble
    slots.push({ key: "hp1", side: "home", label: matchup.home_p1?.display_name ?? homeLabel, sub: `${phcps.homeP1} hcp` });
    slotPhcp.hp1 = phcps.homeP1;
    if (matchup.home_p2) {
      slots.push({ key: "hp2", side: "home", label: matchup.home_p2.display_name, sub: `${phcps.homeP2 ?? 0} hcp` });
      slotPhcp.hp2 = phcps.homeP2 ?? 0;
    }
    slots.push({ key: "ap1", side: "away", label: matchup.away_p1?.display_name ?? awayLabel, sub: `${phcps.awayP1} hcp` });
    slotPhcp.ap1 = phcps.awayP1;
    if (matchup.away_p2) {
      slots.push({ key: "ap2", side: "away", label: matchup.away_p2.display_name, sub: `${phcps.awayP2 ?? 0} hcp` });
      slotPhcp.ap2 = phcps.awayP2 ?? 0;
    }
  }

  const holes: HbhHole[] = holeRows.map((h) => {
    const strokes: Partial<Record<SlotKey, number>> = {};
    for (const sl of slots) {
      strokes[sl.key] = strokesOnHole(slotPhcp[sl.key] ?? 0, h.stroke_index, allHoleSIs, nineHole);
    }
    return { n: h.hole_number, par: h.par, si: h.stroke_index, strokes };
  });

  // Existing scores
  const { data: scoresRaw } = await supabase
    .from("hole_scores")
    .select("hole_number, home_p1_gross, home_p2_gross, away_p1_gross, away_p2_gross")
    .eq("matchup_id", params.matchupId);
  const colBySlot: Record<SlotKey, "home_p1_gross" | "home_p2_gross" | "away_p1_gross" | "away_p2_gross"> = {
    hp1: "home_p1_gross", hp2: "home_p2_gross", ap1: "away_p1_gross", ap2: "away_p2_gross",
  };
  const initialScores: Record<number, Partial<Record<SlotKey, number | null>>> = {};
  for (const s of scoresRaw ?? []) {
    const entry: Partial<Record<SlotKey, number | null>> = {};
    for (const sl of slots) entry[sl.key] = s[colBySlot[sl.key]];
    initialScores[s.hole_number] = entry;
  }

  // Resume on the first hole that isn't fully scored
  let startIndex = holes.findIndex((h) => slots.some((sl) => initialScores[h.n]?.[sl.key] == null));
  if (startIndex === -1) startIndex = holes.length - 1;

  const matchupId = params.matchupId;
  async function saveScore(holeNumber: number, slot: SlotKey, value: number | null) {
    "use server";
    await assertCanScore(matchupId);
    if (!["hp1", "hp2", "ap1", "ap2"].includes(slot)) throw new Error("Bad slot");
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 15)) throw new Error("Bad score");
    await upsertSingleScore(createClient(), matchupId, holeNumber, slot, value);
    revalidatePath(currentPath);
    revalidatePath("/live");
  }

  return (
    <>
      <LiveRefresher matchupId={params.matchupId} />
      <HoleByHole
        slots={slots}
        holes={holes}
        initialScores={initialScores}
        startIndex={startIndex}
        canScore={canScore}
        homeLabel={homeLabel}
        awayLabel={awayLabel}
        homeColor={homeTeam?.color ?? null}
        awayColor={awayTeam?.color ?? null}
        cardHref={`${currentPath}?view=card`}
        reviewHref={`${currentPath}?view=card&review=1`}
        backHref="/live"
        saveScore={saveScore}
      />
    </>
  );
}
