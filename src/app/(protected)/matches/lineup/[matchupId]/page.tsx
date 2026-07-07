import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { LineupPicker, type LineupPlayer } from "@/components/LineupPicker";
import { recordLineup } from "@/lib/feed";

// Full-page lineup picker (bet-wizard style): captains set their team's
// pairing for one match; admins can set either side.
export default async function LineupPage({
  params,
  searchParams,
}: {
  params: { matchupId: string };
  searchParams: { side?: string };
}) {
  const player = await requirePlayer();
  const admin = isAdmin(player);
  const side = searchParams.side === "away" ? "away" : "home";
  const supabase = createClient();

  const { data: matchupRaw } = await supabase
    .from("matchups")
    .select("id, round_id, match_number, status, home_p1_id, home_p2_id, away_p1_id, away_p2_id")
    .eq("id", params.matchupId)
    .single();
  const matchup = matchupRaw as unknown as {
    id: string; round_id: string; match_number: number; status: string;
    home_p1_id: string | null; home_p2_id: string | null;
    away_p1_id: string | null; away_p2_id: string | null;
  } | null;
  if (!matchup) redirect("/matches");

  const { data: roundRaw } = await supabase
    .from("rounds")
    .select("id, event_id, round_number, name, side, formats(name), course_tees(courses(name))")
    .eq("id", matchup.round_id)
    .single();
  const round = roundRaw as unknown as {
    id: string; event_id: string; round_number: number; name: string | null; side: string;
    formats: { name: string } | null;
    course_tees: { courses: { name: string } | null } | null;
  } | null;
  if (!round) redirect("/matches");

  const { data: teams } = await supabase
    .from("teams").select("id, name, color").eq("event_id", round.event_id).order("name");
  const team = side === "home" ? teams?.[0] : teams?.[1];
  if (!team) redirect("/matches");

  // Authorization: admin, or captain of THIS team
  if (!admin) {
    const { data: cap } = await supabase
      .from("event_participants")
      .select("team_id")
      .eq("event_id", round.event_id)
      .eq("player_id", player.id)
      .eq("is_captain", true)
      .maybeSingle();
    if (!cap || cap.team_id !== team.id) redirect("/matches");
  }

  // Locked once complete or underway (admins may still override via Edit)
  const { data: scoreRows } = await supabase
    .from("hole_scores")
    .select("home_p1_gross, home_p2_gross, away_p1_gross, away_p2_gross")
    .eq("matchup_id", params.matchupId);
  const underway = matchup.status === "complete" || (scoreRows ?? []).some(
    (r) => r.home_p1_gross != null || r.home_p2_gross != null || r.away_p1_gross != null || r.away_p2_gross != null,
  );
  if (underway && !admin) redirect("/matches");

  // Roster: this team's participants, minus anyone in another match this round
  const { data: otherMatchups } = await supabase
    .from("matchups")
    .select("home_p1_id, home_p2_id, away_p1_id, away_p2_id")
    .eq("round_id", round.id)
    .neq("id", params.matchupId);
  const used = new Set(
    (otherMatchups ?? []).flatMap((m) =>
      [m.home_p1_id, m.home_p2_id, m.away_p1_id, m.away_p2_id].filter(Boolean) as string[],
    ),
  );

  const { data: epsRaw } = await supabase
    .from("event_participants")
    .select("id, display_name, players(avatar_url)")
    .eq("event_id", round.event_id)
    .eq("team_id", team.id)
    .order("display_name");
  const roster: LineupPlayer[] = ((epsRaw ?? []) as unknown as {
    id: string; display_name: string; players: { avatar_url: string | null } | null;
  }[])
    .filter((p) => !used.has(p.id))
    .map((p) => ({ id: p.id, label: p.display_name, avatarUrl: p.players?.avatar_url ?? null }));

  const isSingles = round.formats?.name === "Singles";
  const initial = side === "home"
    ? [matchup.home_p1_id, matchup.home_p2_id].filter(Boolean) as string[]
    : [matchup.away_p1_id, matchup.away_p2_id].filter(Boolean) as string[];

  const matchupId = params.matchupId;
  const eventId = round.event_id;
  const teamId = team.id;

  async function saveLineup(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");
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
      if (!cap || cap.team_id !== teamId) throw new Error("Not your lineup to set");

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
    if (isSingles || (p2 !== null && p2 === p1)) p2 = null;

    const update = side === "home"
      ? { home_p1_id: p1, home_p2_id: p2 }
      : { away_p1_id: p1, away_p2_id: p2 };
    const { error } = await supabase.from("matchups").update(update).eq("id", matchupId);
    if (error) throw new Error(`Couldn't save lineup: ${error.message}`);
    await recordLineup(supabase, matchupId, side); // best-effort feed entry
    revalidatePath("/matches");
    redirect("/matches");
  }

  return (
    <div className="px-4 py-5 space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/matches" className="text-sm text-navy/50 hover:text-navy">← Matches</Link>
        {underway && admin && (
          <span className="text-[11px] font-semibold text-usa-red">Match underway — admin override</span>
        )}
      </div>

      <div>
        <h1 className="font-display text-2xl font-bold" style={{ color: team.color }}>
          {team.name} lineup
        </h1>
        <p className="text-sm text-navy/50 mt-0.5">
          Match {matchup.match_number} · R{round.round_number}{round.name ? ` — ${round.name}` : ""} · {round.course_tees?.courses?.name} · {round.formats?.name}
        </p>
        <p className="text-xs text-navy/40 mt-1">
          {isSingles ? "Pick 1 player." : "Pick 2 players (or 1 for a 2v1)."} Teammates already in another match this round aren&rsquo;t shown.
        </p>
      </div>

      <LineupPicker
        players={roster}
        max={isSingles ? 1 : 2}
        initial={initial}
        teamName={team.name}
        teamColor={team.color}
        action={saveLineup}
      />
    </div>
  );
}
