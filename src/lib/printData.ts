// Shared loader for the paper scorecards (/print/match/[id] prints one,
// /print/round/[id] prints the whole round). Everything here is per-ROUND;
// the per-match bits (lineup, tee time, format override) come from the caller.

import type { createClient } from "@/lib/supabase/server";
import type { FormatInfo } from "@/lib/matchcalc";
import type { PrintCardData } from "@/components/PrintScorecard";

type Supa = ReturnType<typeof createClient>;

export const PRINT_MATCHUP_SELECT = `
  id, round_id, match_number, tee_time,
  formats(name, hcp_allowance, hcp_allowance_secondary),
  home_p1:event_participants!matchups_home_p1_id_fkey(display_name, player_id),
  home_p2:event_participants!matchups_home_p2_id_fkey(display_name, player_id),
  away_p1:event_participants!matchups_away_p1_id_fkey(display_name, player_id),
  away_p2:event_participants!matchups_away_p2_id_fkey(display_name, player_id)
`;

export interface PrintMatchupRow {
  id: string; round_id: string; match_number: number; tee_time: string | null;
  formats: FormatInfo | null; // per-match override (null = round default)
  home_p1: PrintCardData["matchup"]["home_p1"]; home_p2: PrintCardData["matchup"]["home_p2"];
  away_p1: PrintCardData["matchup"]["away_p1"]; away_p2: PrintCardData["matchup"]["away_p2"];
}

export interface RoundPrintContext {
  eventId: string;
  event: PrintCardData["event"];
  round: PrintCardData["round"];
  roundFmt: FormatInfo;
  teamSize: number | null;
  holes: PrintCardData["holes"];
  homeTeam?: PrintCardData["homeTeam"];
  awayTeam?: PrintCardData["awayTeam"];
  hcpOf: PrintCardData["hcpOf"];
  ctpHoles: number[];
}

function holeNums(side: string): number[] {
  if (side === "front") return Array.from({ length: 9 }, (_, i) => i + 1);
  if (side === "back")  return Array.from({ length: 9 }, (_, i) => i + 10);
  return Array.from({ length: 18 }, (_, i) => i + 1);
}

export async function loadRoundPrintContext(
  supabase: Supa,
  roundId: string,
): Promise<RoundPrintContext | null> {
  const { data: roundRaw } = await supabase
    .from("rounds")
    .select("id, event_id, round_number, name, side, played_at, course_tee_id, formats(name, hcp_allowance, hcp_allowance_secondary, team_size), course_tees(tee_name, rating, slope, par, courses(name))")
    .eq("id", roundId)
    .single();
  const round = roundRaw as unknown as (PrintCardData["round"] & {
    id: string; event_id: string; course_tee_id: string;
    formats: (FormatInfo & { team_size: number | null }) | null;
  }) | null;
  if (!round?.formats) return null;

  const [{ data: event }, { data: teams }, { data: holesRaw }, { data: hcpRows }, { data: ctpRows }] =
    await Promise.all([
      supabase.from("events").select("name, year, location").eq("id", round.event_id).single(),
      supabase.from("teams").select("id, name, color").eq("event_id", round.event_id).order("name"),
      supabase.from("holes").select("hole_number, par, stroke_index")
        .eq("course_tee_id", round.course_tee_id)
        .in("hole_number", holeNums(round.side))
        .order("hole_number"),
      supabase.from("participant_handicaps").select("player_id, calculated_hcp, override_hcp")
        .eq("event_id", round.event_id)
        .eq("course_tee_id", round.course_tee_id),
      supabase.from("ctp_holes").select("hole_number").eq("round_id", roundId),
    ]);

  const hcpOf = (pid: string | null | undefined): number => {
    if (!pid) return 0;
    const row = hcpRows?.find((h) => h.player_id === pid);
    return row?.override_hcp ?? row?.calculated_hcp ?? 0;
  };

  return {
    eventId: round.event_id,
    event: event ?? null,
    round,
    roundFmt: round.formats,
    teamSize: round.formats.team_size,
    holes: holesRaw ?? [],
    homeTeam: teams?.[0],
    awayTeam: teams?.[1],
    hcpOf,
    ctpHoles: (ctpRows ?? []).map((c) => c.hole_number),
  };
}
