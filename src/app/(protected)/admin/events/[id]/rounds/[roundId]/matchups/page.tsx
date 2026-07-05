import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { DeleteButton } from "@/components/DeleteButton";
import { ErrorBanner } from "@/components/ErrorBanner";
import { failTo } from "@/lib/actionError";

export default async function MatchupsPage({
  params,
  searchParams,
}: {
  params: { id: string; roundId: string };
  searchParams: { error?: string };
}) {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const supabase = createClient();

  const { data: roundRaw } = await supabase
    .from("rounds")
    .select("id, round_number, name, side, formats(id, name), course_tees(tee_name, courses(name))")
    .eq("id", params.roundId)
    .single();
  const round = roundRaw as unknown as {
    id: string; round_number: number; name: string | null; side: string;
    formats: { id: string; name: string } | null;
    course_tees: { tee_name: string; courses: { name: string } | null } | null;
  } | null;
  if (!round) redirect(`/admin/events/${params.id}`);

  const isSingles = round.formats?.name === "Singles";
  const sideLabel: Record<string, string> = { front: "Front 9", back: "Back 9", full: "Full 18" };

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

  const homePlayers = participants.filter((p) => p.team_id === homeTeam?.id);
  const awayPlayers = participants.filter((p) => p.team_id === awayTeam?.id);

  const { data: matchupsRaw } = await supabase
    .from("matchups")
    .select(`
      id, match_number, status, result, tee_time, match_score,
      home_p1:event_participants!matchups_home_p1_id_fkey(id, display_name),
      home_p2:event_participants!matchups_home_p2_id_fkey(id, display_name),
      away_p1:event_participants!matchups_away_p1_id_fkey(id, display_name),
      away_p2:event_participants!matchups_away_p2_id_fkey(id, display_name)
    `)
    .eq("round_id", params.roundId)
    .order("tee_time", { ascending: true, nullsFirst: false })
    .order("match_number");
  const matchups = (matchupsRaw ?? []) as unknown as {
    id: string; match_number: number; status: string; result: string | null;
    tee_time: string | null; match_score: string | null;
    home_p1: { id: string; display_name: string } | null;
    home_p2: { id: string; display_name: string } | null;
    away_p1: { id: string; display_name: string } | null;
    away_p2: { id: string; display_name: string } | null;
  }[];

  const usedIds = new Set(
    matchups.flatMap((m) =>
      [m.home_p1?.id, m.home_p2?.id, m.away_p1?.id, m.away_p2?.id].filter(Boolean)
    )
  );
  const availableHome = homePlayers.filter((p) => !usedIds.has(p.id));
  const availableAway = awayPlayers.filter((p) => !usedIds.has(p.id));

  // ── Server actions ──────────────────────────────────────────

  async function addMatchup(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { data: existing } = await supabase
      .from("matchups")
      .select("match_number")
      .eq("round_id", params.roundId)
      .order("match_number", { ascending: false })
      .limit(1);
    const nextNum = ((existing?.[0]?.match_number) ?? 0) + 1;
    const teeTime = formData.get("tee_time") as string;

    const { error } = await supabase.from("matchups").insert({
      round_id:     params.roundId,
      match_number: nextNum,
      home_p1_id:   formData.get("home_p1") as string || null,
      home_p2_id:   isSingles ? null : (formData.get("home_p2") as string || null),
      away_p1_id:   formData.get("away_p1") as string || null,
      away_p2_id:   isSingles ? null : (formData.get("away_p2") as string || null),
      tee_time:     teeTime || null,
    });
    failTo(`/admin/events/${params.id}/rounds/${params.roundId}/matchups`, error);
    revalidatePath(`/admin/events/${params.id}/rounds/${params.roundId}/matchups`);
  }

  async function saveTeeTime(formData: FormData) {
    "use server";
    const supabase = createClient();
    const teeTime = formData.get("tee_time") as string;
    const { error } = await supabase
      .from("matchups")
      .update({ tee_time: teeTime || null })
      .eq("id", formData.get("matchup_id") as string);
    failTo(`/admin/events/${params.id}/rounds/${params.roundId}/matchups`, error);
    revalidatePath(`/admin/events/${params.id}/rounds/${params.roundId}/matchups`);
  }

  async function deleteMatchup(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("matchups").delete().eq("id", formData.get("matchup_id") as string);
    failTo(`/admin/events/${params.id}/rounds/${params.roundId}/matchups`, error);
    revalidatePath(`/admin/events/${params.id}/rounds/${params.roundId}/matchups`);
  }

  function resultDisplay(result: string | null, matchScore: string | null) {
    if (!result) return null;
    const homeName = homeTeam?.name ?? "Home";
    const awayName = awayTeam?.name ?? "Away";
    const label =
      result === "home"  ? `${homeName} wins` :
      result === "away"  ? `${awayName} wins` :
      "Halved";
    const points =
      result === "home"  ? `${homeName} 1 – 0 ${awayName}` :
      result === "away"  ? `${homeName} 0 – 1 ${awayName}` :
      `${homeName} ½ – ½ ${awayName}`;
    return { label, points, score: matchScore };
  }

  function fmt12(t: string | null) {
    if (!t) return null;
    const [hStr, mStr] = t.split(":");
    const h = parseInt(hStr);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${mStr} ${ampm}`;
  }

  const canAdd = availableHome.length >= 1 && availableAway.length >= 1;

  return (
    <div className="px-4 py-6 space-y-6">
      <Link href={`/admin/events/${params.id}`} className="text-sm text-navy/50 hover:text-navy">
        ← {round.name ?? `Round ${round.round_number}`}
      </Link>
      <ErrorBanner message={searchParams.error} />

      <div>
        <h1 className="text-2xl font-display font-bold text-navy">
          Matchups — Round {round.round_number}
          {round.name ? ` · ${round.name}` : ""}
        </h1>
        <p className="text-sm text-navy/50 mt-0.5">
          {round.course_tees?.courses?.name} · {round.course_tees?.tee_name} Tees ·{" "}
          {sideLabel[round.side]} · {round.formats?.name}
        </p>
      </div>

      {/* Matchup list */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-navy/60 uppercase tracking-wide">
          {matchups.length} Match{matchups.length !== 1 ? "es" : ""}
        </p>
        {matchups.length === 0 && <p className="text-sm text-navy/40">No matchups yet.</p>}

        {matchups.map((m) => {
          const homePairing = isSingles
            ? (m.home_p1?.display_name ?? "—")
            : [m.home_p1?.display_name, m.home_p2?.display_name].filter(Boolean).join(" / ") || "—";
          const awayPairing = isSingles
            ? (m.away_p1?.display_name ?? "—")
            : [m.away_p1?.display_name, m.away_p2?.display_name].filter(Boolean).join(" / ") || "—";

          return (
            <div key={m.id} className="rounded-xl border border-hairline bg-white px-4 py-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-navy/40 font-semibold uppercase tracking-wide mb-1">
                    Match {m.match_number}
                    {m.tee_time && (
                      <span className="ml-2 font-normal normal-case text-navy/50">
                        · {fmt12(m.tee_time)}
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <span className="font-semibold text-navy">{homePairing}</span>
                    <span className="text-navy/30">vs</span>
                    <span className="font-semibold text-navy">{awayPairing}</span>
                  </div>
                  {(() => {
                    const r = resultDisplay(m.result, m.match_score);
                    if (!r) return null;
                    return (
                      <div className="mt-1 space-y-0.5">
                        <p className="text-xs font-semibold text-navy/70">{r.label}{r.score ? ` · ${r.score}` : ""}</p>
                        <p className="text-xs text-navy/40">{r.points}</p>
                      </div>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    m.status === "complete" ? "bg-green-100 text-green-700"
                    : m.status === "active"  ? "bg-amber-100 text-amber-700"
                    : "bg-navy/10 text-navy/50"
                  }`}>
                    {m.status}
                  </span>
                  <Link href={`/admin/events/${params.id}/rounds/${params.roundId}/matchups/${m.id}/scorecard`}
                    className="text-sm text-navy/60 hover:text-navy">
                    Scorecard ›
                  </Link>
                  <Link href={`/admin/events/${params.id}/rounds/${params.roundId}/matchups/${m.id}`}
                    className="text-sm text-navy/60 hover:text-navy">
                    Edit ›
                  </Link>
                  <DeleteButton
                    action={deleteMatchup}
                    fields={{ matchup_id: m.id }}
                    confirm={`Delete Match ${m.match_number}?`}
                    label="Delete"
                    className="text-xs text-usa-red hover:underline"
                  />
                </div>
              </div>

              {/* Inline tee time edit */}
              <form action={saveTeeTime} className="flex items-center gap-2 border-t border-hairline pt-2">
                <input type="hidden" name="matchup_id" value={m.id} />
                <label className="text-xs text-navy/50 w-16 flex-shrink-0">Tee time</label>
                <input
                  name="tee_time"
                  type="time"
                  defaultValue={m.tee_time ?? ""}
                  className="flex-1 rounded border border-hairline px-2 py-1 text-sm text-navy"
                />
                <button type="submit" className="text-xs text-navy/50 hover:text-navy underline flex-shrink-0">
                  Save
                </button>
              </form>
            </div>
          );
        })}
      </div>

      {/* Add matchup form */}
      {canAdd ? (
        <form action={addMatchup} className="rounded-xl border border-dashed border-hairline p-4 space-y-4">
          <p className="font-semibold text-navy text-sm">Add Matchup</p>

          {/* Tee time */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-navy/60 w-20 flex-shrink-0">Tee time</label>
            <input
              name="tee_time"
              type="time"
              className="flex-1 rounded-lg border border-hairline px-3 py-2 text-sm text-navy"
            />
          </div>

          {/* Home team */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-navy/60 uppercase tracking-wide flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: homeTeam?.color ?? "#ccc" }} />
              {homeTeam?.name ?? "Home"}
            </p>
            <select name="home_p1" required
              className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
              <option value="">Select player…</option>
              {availableHome.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </select>
            {!isSingles && (
              <select name="home_p2"
                className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
                <option value="">Partner (optional for 2v1)</option>
                {availableHome.map((p) => (
                  <option key={p.id} value={p.id}>{p.display_name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Away team */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-navy/60 uppercase tracking-wide flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: awayTeam?.color ?? "#ccc" }} />
              {awayTeam?.name ?? "Away"}
            </p>
            <select name="away_p1" required
              className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
              <option value="">Select player…</option>
              {availableAway.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </select>
            {!isSingles && (
              <select name="away_p2"
                className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
                <option value="">Partner (optional for 2v1)</option>
                {availableAway.map((p) => (
                  <option key={p.id} value={p.id}>{p.display_name}</option>
                ))}
              </select>
            )}
          </div>

          <button type="submit"
            className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
            Add Match
          </button>
        </form>
      ) : matchups.length > 0 ? (
        <p className="text-sm text-navy/40">All available players have been paired.</p>
      ) : (
        <p className="text-sm text-navy/40">Add players to team rosters before creating matchups.</p>
      )}
    </div>
  );
}
