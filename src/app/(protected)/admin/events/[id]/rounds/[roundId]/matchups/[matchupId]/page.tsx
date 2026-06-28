import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";

export default async function EditMatchupPage({
  params,
}: {
  params: { id: string; roundId: string; matchupId: string };
}) {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const supabase = createClient();

  const { data: roundRaw } = await supabase
    .from("rounds")
    .select("id, round_number, name, formats(name)")
    .eq("id", params.roundId)
    .single();
  const round = roundRaw as unknown as {
    id: string; round_number: number; name: string | null;
    formats: { name: string } | null;
  } | null;
  if (!round) redirect(`/admin/events/${params.id}`);

  const isSingles = round.formats?.name === "Singles";

  const { data: matchupRaw } = await supabase
    .from("matchups")
    .select(`
      id, match_number, status, result, tee_time, match_score,
      home_p1:event_participants!matchups_home_p1_id_fkey(id, display_name),
      home_p2:event_participants!matchups_home_p2_id_fkey(id, display_name),
      away_p1:event_participants!matchups_away_p1_id_fkey(id, display_name),
      away_p2:event_participants!matchups_away_p2_id_fkey(id, display_name)
    `)
    .eq("id", params.matchupId)
    .single();
  const matchup = matchupRaw as unknown as {
    id: string; match_number: number; status: string; result: string | null;
    tee_time: string | null; match_score: string | null;
    home_p1: { id: string; display_name: string } | null;
    home_p2: { id: string; display_name: string } | null;
    away_p1: { id: string; display_name: string } | null;
    away_p2: { id: string; display_name: string } | null;
  } | null;
  if (!matchup) redirect(`/admin/events/${params.id}/rounds/${params.roundId}/matchups`);

  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, color")
    .eq("event_id", params.id)
    .order("name");

  const homeTeam = teams?.[0] ?? null;
  const awayTeam = teams?.[1] ?? null;

  const { data: participantsRaw } = await supabase
    .from("event_participants")
    .select("id, display_name, team_id")
    .eq("event_id", params.id)
    .order("display_name");
  const participants = participantsRaw ?? [];

  // All players on each team, excluding those in OTHER matchups (not this one)
  const { data: otherMatchupsRaw } = await supabase
    .from("matchups")
    .select("home_p1_id, home_p2_id, away_p1_id, away_p2_id")
    .eq("round_id", params.roundId)
    .neq("id", params.matchupId);
  const usedElsewhere = new Set(
    (otherMatchupsRaw ?? []).flatMap((m) =>
      [m.home_p1_id, m.home_p2_id, m.away_p1_id, m.away_p2_id].filter(Boolean)
    )
  );

  const homePlayers = participants.filter(
    (p) => p.team_id === homeTeam?.id && !usedElsewhere.has(p.id)
  );
  const awayPlayers = participants.filter(
    (p) => p.team_id === awayTeam?.id && !usedElsewhere.has(p.id)
  );

  const matchupsPath = `/admin/events/${params.id}/rounds/${params.roundId}/matchups`;

  async function saveMatchup(formData: FormData) {
    "use server";
    const supabase = createClient();
    const teeTime = formData.get("tee_time") as string;
    await supabase.from("matchups").update({
      home_p1_id:  formData.get("home_p1") as string || null,
      home_p2_id:  isSingles ? null : (formData.get("home_p2") as string || null),
      away_p1_id:  formData.get("away_p1") as string || null,
      away_p2_id:  isSingles ? null : (formData.get("away_p2") as string || null),
      tee_time:    teeTime || null,
      status:      formData.get("status") as string,
      result:      formData.get("result") as string || null,
      match_score: formData.get("match_score") as string || null,
    }).eq("id", params.matchupId);
    revalidatePath(matchupsPath);
    redirect(matchupsPath);
  }

  return (
    <div className="px-4 py-6 space-y-6">
      <Link href={matchupsPath} className="text-sm text-navy/50 hover:text-navy">
        ← Matchups
      </Link>

      <h1 className="text-2xl font-display font-bold text-navy">
        Edit Match {matchup.match_number}
      </h1>

      <form action={saveMatchup} className="space-y-5">

        {/* Tee time */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-navy">Tee time</label>
          <input
            name="tee_time"
            type="time"
            defaultValue={matchup.tee_time ?? ""}
            className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy"
          />
        </div>

        {/* Home team */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-navy flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: homeTeam?.color ?? "#ccc" }} />
            {homeTeam?.name ?? "Home"}
          </p>
          <select name="home_p1" required
            className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white"
            defaultValue={matchup.home_p1?.id ?? ""}>
            <option value="">Select player…</option>
            {homePlayers.map((p) => (
              <option key={p.id} value={p.id}>{p.display_name}</option>
            ))}
          </select>
          {!isSingles && (
            <select name="home_p2"
              className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white"
              defaultValue={matchup.home_p2?.id ?? ""}>
              <option value="">Partner (optional for 2v1)</option>
              {homePlayers.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Away team */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-navy flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: awayTeam?.color ?? "#ccc" }} />
            {awayTeam?.name ?? "Away"}
          </p>
          <select name="away_p1" required
            className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white"
            defaultValue={matchup.away_p1?.id ?? ""}>
            <option value="">Select player…</option>
            {awayPlayers.map((p) => (
              <option key={p.id} value={p.id}>{p.display_name}</option>
            ))}
          </select>
          {!isSingles && (
            <select name="away_p2"
              className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white"
              defaultValue={matchup.away_p2?.id ?? ""}>
              <option value="">Partner (optional for 2v1)</option>
              {awayPlayers.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Status + Result */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-navy">Status</label>
            <select name="status" defaultValue={matchup.status}
              className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
              <option value="pending">Pending</option>
              <option value="active">Active</option>
              <option value="complete">Complete</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-navy">Result</label>
            <select name="result" defaultValue={matchup.result ?? ""}
              className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
              <option value="">—</option>
              <option value="home">{homeTeam?.name ?? "Home"} wins</option>
              <option value="away">{awayTeam?.name ?? "Away"} wins</option>
              <option value="halve">Halved</option>
            </select>
          </div>
        </div>

        {/* Match score */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-navy">Match score</label>
          <input
            name="match_score"
            type="text"
            defaultValue={matchup.match_score ?? ""}
            placeholder="e.g. 4&3, 2&1, 1 up, All Square"
            className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy"
          />
        </div>

        <button type="submit"
          className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
          Save Changes
        </button>
      </form>
    </div>
  );
}
