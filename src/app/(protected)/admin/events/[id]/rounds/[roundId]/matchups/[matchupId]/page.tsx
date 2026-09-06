import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { failTo } from "@/lib/actionError";
import { ErrorBanner } from "@/components/ErrorBanner";

export default async function EditMatchupPage({
  params,
  searchParams,
}: {
  params: { id: string; roundId: string; matchupId: string };
  searchParams: { error?: string };
}) {
  const player = await requirePlayer();
  const supabase = createClient();

  // Admins edit everything; captains edit their own team's lineup only.
  const admin = isAdmin(player);
  const { data: captainEp } = await supabase
    .from("event_participants")
    .select("team_id")
    .eq("event_id", params.id)
    .eq("player_id", player.id)
    .eq("is_captain", true)
    .maybeSingle();
  if (!admin && !captainEp) redirect("/");

  const { data: roundRaw } = await supabase
    .from("rounds")
    .select("id, round_number, name, formats(id, name, team_size)")
    .eq("id", params.roundId)
    .single();
  const round = roundRaw as unknown as {
    id: string; round_number: number; name: string | null;
    formats: { id: string; name: string; team_size: number | null } | null;
  } | null;
  if (!round) redirect(`/admin/events/${params.id}`);

  const isSingles = round.formats?.name === "Singles";

  const { data: matchupRaw } = await supabase
    .from("matchups")
    .select(`
      id, match_number, status, result, tee_time, match_score, format_id,
      home_p1:event_participants!matchups_home_p1_id_fkey(id, display_name),
      home_p2:event_participants!matchups_home_p2_id_fkey(id, display_name),
      away_p1:event_participants!matchups_away_p1_id_fkey(id, display_name),
      away_p2:event_participants!matchups_away_p2_id_fkey(id, display_name)
    `)
    .eq("id", params.matchupId)
    .single();
  const matchup = matchupRaw as unknown as {
    id: string; match_number: number; status: string; result: string | null;
    tee_time: string | null; match_score: string | null; format_id: string | null;
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

  // Once a match has scores, captains are locked out of lineup changes
  // (admins can still override)
  const { data: scoreRows } = await supabase
    .from("hole_scores")
    .select("home_p1_gross, home_p2_gross, away_p1_gross, away_p2_gross")
    .eq("matchup_id", params.matchupId);
  const underway = (scoreRows ?? []).some(
    (r) => r.home_p1_gross != null || r.home_p2_gross != null || r.away_p1_gross != null || r.away_p2_gross != null,
  );

  const captainMay = captainEp != null && !underway;
  const canHome = admin || (captainMay && captainEp!.team_id === homeTeam?.id);
  const canAway = admin || (captainMay && captainEp!.team_id === awayTeam?.id);
  const canMeta = admin; // tee time, status, result, match score
  // Format override: admin, or either captain until the match is underway.
  const canFormat = admin || captainMay;

  // A match may deviate from the round format, but only to one with the same
  // team size — Singles ↔ 2-man changes the pairing shape and is not offered.
  const { data: formatRows } = await supabase
    .from("formats")
    .select("id, name, team_size")
    .order("sort_order");
  const roundTeamSize = round.formats?.team_size ?? null;
  const formatOptions = (formatRows ?? []).filter(
    (f) => (f.team_size ?? null) === roundTeamSize && f.id !== round.formats?.id,
  );

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
  const editPath = `${matchupsPath}/${params.matchupId}`;

  async function saveMatchup(formData: FormData) {
    "use server";
    const supabase = createClient();
    // Partial update scoped to what this viewer may edit (captains: own side
    // only). Disabled selects don't submit, so untouchable fields stay put.
    const update: Record<string, string | null> = {};
    if (canHome) {
      update.home_p1_id = (formData.get("home_p1") as string) || null;
      update.home_p2_id = isSingles ? null : ((formData.get("home_p2") as string) || null);
      if (update.home_p2_id && update.home_p2_id === update.home_p1_id) update.home_p2_id = null;
    }
    if (canAway) {
      update.away_p1_id = (formData.get("away_p1") as string) || null;
      update.away_p2_id = isSingles ? null : ((formData.get("away_p2") as string) || null);
      if (update.away_p2_id && update.away_p2_id === update.away_p1_id) update.away_p2_id = null;
    }
    if (canFormat) {
      const wanted = (formData.get("format_id") as string) || null;
      if (wanted && !formatOptions.some((f) => f.id === wanted)) {
        failTo(editPath, { message: "That format isn't available for this round (team size differs)." });
      }
      update.format_id = wanted;
    }
    if (canMeta) {
      update.tee_time    = (formData.get("tee_time") as string) || null;
      update.status      = formData.get("status") as string;
      update.result      = (formData.get("result") as string) || null;
      update.match_score = (formData.get("match_score") as string) || null;
    }
    const { error } = await supabase.from("matchups").update(update).eq("id", params.matchupId);
    failTo(editPath, error);
    revalidatePath(matchupsPath);
    revalidatePath("/matches");
    redirect(admin ? matchupsPath : "/matches");
  }

  return (
    <div className="px-4 py-6 space-y-6">
      <Link href={admin ? matchupsPath : "/matches"} className="text-sm text-navy/50 hover:text-navy">
        ← Matchups
      </Link>

      {!admin && (
        <p className="rounded-lg bg-parchment px-3 py-2 text-xs text-navy/60">
          {underway
            ? "This match is underway — lineups are locked. Ask the commissioner if something needs changing."
            : "Captain mode — you can set your own team's lineup. Tee times and results are set by the commissioner."}
        </p>
      )}

      <h1 className="text-2xl font-display font-bold text-navy">
        Edit Match {matchup.match_number}
      </h1>

      <ErrorBanner message={searchParams.error} />

      <form action={saveMatchup} className="space-y-5">

        {/* Tee time */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-navy">Tee time</label>
          <input
            name="tee_time"
            type="time"
            disabled={!canMeta}
            defaultValue={matchup.tee_time ?? ""}
            className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy disabled:bg-parchment disabled:text-navy/50"
          />
        </div>

        {/* Format — round default, or a per-match override */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-navy">Format</label>
          <select name="format_id" disabled={!canFormat} defaultValue={matchup.format_id ?? ""}
            className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white disabled:bg-parchment disabled:text-navy/50">
            <option value="">Round default{round.formats ? ` — ` : ""}</option>
            {formatOptions.map((f) => (
              <option key={f.id} value={f.id}>{f.name} (this match only)</option>
            ))}
          </select>
          <p className="text-xs text-navy/50">
            {formatOptions.length > 0
              ? "Change only if this group is playing something different — e.g. a 3-man group doing a Shamble. Locks once the match is underway."
              : "No alternate formats share this round's team size."}
          </p>
        </div>

        {/* Home team */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-navy flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: homeTeam?.color ?? "#ccc" }} />
            {homeTeam?.name ?? "Home"}
          </p>
          <select name="home_p1" disabled={!canHome}
            className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white disabled:bg-parchment disabled:text-navy/50"
            defaultValue={matchup.home_p1?.id ?? ""}>
            <option value="">Select player…</option>
            {homePlayers.map((p) => (
              <option key={p.id} value={p.id}>{p.display_name}</option>
            ))}
          </select>
          {!isSingles && (
            <select name="home_p2" disabled={!canHome}
              className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white disabled:bg-parchment disabled:text-navy/50"
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
          <select name="away_p1" disabled={!canAway}
            className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white disabled:bg-parchment disabled:text-navy/50"
            defaultValue={matchup.away_p1?.id ?? ""}>
            <option value="">Select player…</option>
            {awayPlayers.map((p) => (
              <option key={p.id} value={p.id}>{p.display_name}</option>
            ))}
          </select>
          {!isSingles && (
            <select name="away_p2" disabled={!canAway}
              className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white disabled:bg-parchment disabled:text-navy/50"
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
            <select name="status" defaultValue={matchup.status} disabled={!canMeta}
              className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white disabled:bg-parchment disabled:text-navy/50">
              <option value="pending">Pending</option>
              <option value="active">Active</option>
              <option value="complete">Complete</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-navy">Result</label>
            <select name="result" defaultValue={matchup.result ?? ""} disabled={!canMeta}
              className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white disabled:bg-parchment disabled:text-navy/50">
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
            disabled={!canMeta}
            defaultValue={matchup.match_score ?? ""}
            placeholder="e.g. 4&3, 2&1, 1 up, All Square"
            className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy disabled:bg-parchment disabled:text-navy/50"
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
