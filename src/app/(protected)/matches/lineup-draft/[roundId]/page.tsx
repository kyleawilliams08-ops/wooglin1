import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import {
  LineupDraftRoom,
  type LineupDraftView,
  type LineupMatchupView,
  type RosterPlayer,
  type SidePlayer,
} from "@/components/LineupDraftRoom";

export const dynamic = "force-dynamic";

type Part = {
  id: string;
  player_id: string | null;
  team_id: string | null;
  display_name: string;
  is_captain: boolean;
  players: { nickname: string | null; avatar_url: string | null; current_index: number | null } | null;
};

export default async function LineupDraftPage({ params }: { params: { roundId: string } }) {
  const player = await requirePlayer();
  const supabase = createClient();

  const { data: draft } = await supabase
    .from("lineup_drafts").select("*").eq("round_id", params.roundId).single();

  const { data: round } = await supabase
    .from("rounds")
    .select("id, event_id, round_number, name, formats(team_size), events(name)")
    .eq("id", params.roundId).single();

  if (!draft || !round) {
    return (
      <div className="px-4 py-6 space-y-4">
        <Link href="/matches" className="text-sm text-navy/50 hover:text-navy">← Matches</Link>
        <h1 className="text-2xl font-display font-bold text-navy">Lineup Draft</h1>
        <p className="rounded-lg bg-parchment px-4 py-6 text-center text-sm text-navy/50">
          No lineup draft is running for this round.
        </p>
      </div>
    );
  }

  const sideSize = (((round.formats as unknown as { team_size: number | null } | null)?.team_size) ?? 1) === 2 ? 2 : 1;
  const eventName = (round.events as unknown as { name: string } | null)?.name ?? "";

  const { data: teamsRaw } = await supabase
    .from("teams").select("id, name, color").eq("event_id", round.event_id).order("name");
  const teams = teamsRaw ?? [];
  const homeTeam = teams[0];
  const awayTeam = teams[1];

  if (!homeTeam || !awayTeam) {
    return (
      <div className="px-4 py-6 space-y-4">
        <Link href="/matches" className="text-sm text-navy/50 hover:text-navy">← Matches</Link>
        <p className="rounded-lg bg-usa-red/10 px-3 py-2 text-sm text-usa-red">
          This event needs two teams to draft lineups.
        </p>
      </div>
    );
  }

  const { data: participantsRaw } = await supabase
    .from("event_participants")
    .select("id, player_id, team_id, display_name, is_captain, players(nickname, avatar_url, current_index)")
    .eq("event_id", round.event_id);
  const parts = (participantsRaw ?? []) as unknown as Part[];
  const nameOf = (p: Part) => p.players?.nickname ?? p.display_name;
  const byId = new Map(parts.map((p) => [p.id, p]));

  const captainName = (teamId: string) => {
    const cap = parts.find((p) => p.is_captain && p.team_id === teamId);
    return cap ? nameOf(cap) : null;
  };

  const rosters: Record<string, RosterPlayer[]> = {};
  for (const team of [homeTeam, awayTeam]) {
    rosters[team.id] = parts
      .filter((p) => p.team_id === team.id)
      .map((p) => ({
        id: p.id, name: nameOf(p),
        avatarUrl: p.players?.avatar_url ?? null,
        index: p.players?.current_index ?? null,
      }))
      .sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
  }

  const { data: matchupsRaw } = await supabase
    .from("matchups")
    .select("id, match_number, home_p1_id, home_p2_id, away_p1_id, away_p2_id")
    .eq("round_id", params.roundId)
    .order("match_number");

  const side = (pid: string | null): SidePlayer | null => {
    if (!pid) return null;
    const p = byId.get(pid);
    return p ? { id: p.id, name: nameOf(p), avatarUrl: p.players?.avatar_url ?? null } : null;
  };
  const matchups: LineupMatchupView[] = (matchupsRaw ?? []).map((m) => ({
    id: m.id,
    matchNumber: m.match_number,
    home: { p1: side(m.home_p1_id), p2: side(m.home_p2_id) },
    away: { p1: side(m.away_p1_id), p2: side(m.away_p2_id) },
  }));

  const { data: picksRaw } = await supabase
    .from("lineup_draft_picks")
    .select("pick_number, team_id, p1_id, p2_id")
    .eq("draft_id", draft.id)
    .order("pick_number");
  const picks = (picksRaw ?? []).map((pk) => ({
    pickNumber: pk.pick_number,
    teamId: pk.team_id,
    names: [pk.p1_id, pk.p2_id]
      .filter(Boolean)
      .map((id) => (byId.get(id as string) ? nameOf(byId.get(id as string)!) : "?")),
  }));

  const myCaptaincy = parts.find((p) => p.is_captain && p.player_id === player.id);

  const view: LineupDraftView = {
    id: draft.id,
    status: draft.status,
    roundNumber: round.round_number,
    roundName: round.name,
    eventName,
    sideSize,
    pickSeconds: draft.pick_seconds,
    currentPickStartedAt: draft.current_pick_started_at,
    homeTeam: { ...homeTeam, captainName: captainName(homeTeam.id) },
    awayTeam: { ...awayTeam, captainName: captainName(awayTeam.id) },
    firstPickTeamId: draft.first_pick_team_id ?? homeTeam.id,
    matchups,
    rosters,
    picks,
    captainOf: myCaptaincy?.team_id ?? null,
    viewerIsAdmin: isAdmin(player),
  };

  return (
    <div className="px-4 py-6 space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-display font-bold text-navy">
          Round {round.round_number} Draft
        </h1>
        <Link href="/matches" className="text-sm text-navy/50 underline underline-offset-2 hover:text-navy">
          Matches
        </Link>
      </div>
      <LineupDraftRoom draft={view} />
    </div>
  );
}
