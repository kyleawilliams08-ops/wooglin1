import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { DeleteButton } from "@/components/DeleteButton";
import { courseHandicap, formatHcp, parseHcpInput } from "@/lib/handicap";

export default async function TeamRosterPage({ params }: { params: { id: string; teamId: string } }) {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const supabase = createClient();

  const { data: team } = await supabase.from("teams").select("*, events(name, year)").eq("id", params.teamId).single();
  if (!team) redirect(`/admin/events/${params.id}`);

  const { data: roster } = await supabase
    .from("event_participants")
    .select("*, players(id, name, nickname, current_index)")
    .eq("team_id", params.teamId)
    .order("display_name");

  // Tee sets for courses linked to this event
  const { data: eventCoursesRaw } = await supabase
    .from("event_courses")
    .select("course_id")
    .eq("event_id", params.id);
  const linkedCourseIds = (eventCoursesRaw ?? []).map((ec: { course_id: string }) => ec.course_id);

  const { data: teesRaw } = await supabase
    .from("course_tees")
    .select("id, tee_name, rating, slope, par, courses(name)")
    .in("course_id", linkedCourseIds.length > 0 ? linkedCourseIds : ["00000000-0000-0000-0000-000000000000"])
    .order("tee_name");
  const tees = (teesRaw ?? []) as unknown as {
    id: string; tee_name: string; rating: number; slope: number; par: number;
    courses: { name: string } | null;
  }[];

  // Existing handicap records for this event
  const playerIds = (roster ?? []).map((ep) => {
    const p = ep.players as { id: string } | null;
    return p?.id;
  }).filter(Boolean) as string[];

  const { data: hcpRows } = await supabase
    .from("participant_handicaps")
    .select("player_id, course_tee_id, calculated_hcp, override_hcp")
    .eq("event_id", params.id)
    .in("player_id", playerIds.length > 0 ? playerIds : ["00000000-0000-0000-0000-000000000000"]);

  // hcpMap[playerId][teeId] = { calculated, override }
  const hcpMap: Record<string, Record<string, { calculated: number | null; override: number | null }>> = {};
  for (const row of hcpRows ?? []) {
    if (!hcpMap[row.player_id]) hcpMap[row.player_id] = {};
    hcpMap[row.player_id][row.course_tee_id] = {
      calculated: row.calculated_hcp,
      override:   row.override_hcp,
    };
  }

  // Players not already on any team for this event
  const { data: allPlayers } = await supabase.from("players").select("id, name, nickname, current_index").order("name");
  const { data: taken } = await supabase.from("event_participants").select("player_id").eq("event_id", params.id);
  const takenIds = new Set(taken?.map((t) => t.player_id));
  const available = allPlayers?.filter((p) => !takenIds.has(p.id)) ?? [];

  // ── Server actions ──────────────────────────────────────────────────────

  async function addPlayer(formData: FormData) {
    "use server";
    const supabase = createClient();
    const playerId = formData.get("player_id") as string;
    const { data: p } = await supabase.from("players").select("nickname, name").eq("id", playerId).single();
    await supabase.from("event_participants").insert({
      event_id:     params.id,
      team_id:      params.teamId,
      player_id:    playerId,
      display_name: p?.nickname ?? p?.name ?? "",
      is_captain:   formData.get("is_captain") === "on",
    });
    revalidatePath(`/admin/events/${params.id}/teams/${params.teamId}`);
  }

  async function removePlayer(formData: FormData) {
    "use server";
    const supabase = createClient();
    await supabase.from("event_participants").delete().eq("id", formData.get("ep_id") as string);
    revalidatePath(`/admin/events/${params.id}/teams/${params.teamId}`);
  }

  async function toggleCaptain(formData: FormData) {
    "use server";
    const supabase = createClient();
    const isCaptain = formData.get("is_captain") === "true";
    await supabase.from("event_participants").update({ is_captain: !isCaptain }).eq("id", formData.get("ep_id") as string);
    revalidatePath(`/admin/events/${params.id}/teams/${params.teamId}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function calculateHandicaps(_formData: FormData) {
    "use server";
    const supabase = createClient();
    // Get all participants for this event (not just this team) with their index
    const { data: allEps } = await supabase
      .from("event_participants")
      .select("player_id, players(current_index)")
      .eq("event_id", params.id);

    const { data: eventCourses } = await supabase
      .from("event_courses")
      .select("course_id")
      .eq("event_id", params.id);
    const courseIds = (eventCourses ?? []).map((ec: { course_id: string }) => ec.course_id);

    const { data: tees } = await supabase
      .from("course_tees")
      .select("id, rating, slope, par")
      .in("course_id", courseIds.length > 0 ? courseIds : ["00000000-0000-0000-0000-000000000000"]);

    for (const ep of allEps ?? []) {
      const p = ep.players as unknown as { current_index: number | null } | null;
      if (p?.current_index == null) continue;
      for (const tee of tees ?? []) {
        const calc = courseHandicap(p.current_index, tee);
        await supabase.from("participant_handicaps").upsert({
          event_id:       params.id,
          player_id:      ep.player_id,
          course_tee_id:  tee.id,
          calculated_hcp: calc,
        }, { onConflict: "event_id,player_id,course_tee_id", ignoreDuplicates: false });
      }
    }
    revalidatePath(`/admin/events/${params.id}/teams/${params.teamId}`);
  }

  async function savePlayerHandicaps(formData: FormData) {
    "use server";
    const supabase = createClient();
    const playerId  = formData.get("player_id") as string;
    const teeIds    = (formData.get("tee_ids") as string).split(",");
    for (const teeId of teeIds) {
      const raw = formData.get(`hcp_${teeId}`) as string;
      // Accepts "+2" (plus handicap → stored negative); whole numbers per USGA
      const parsed = parseHcpInput(raw);
      const override = parsed != null ? Math.round(parsed) : null;
      await supabase.from("participant_handicaps").upsert({
        event_id:      params.id,
        player_id:     playerId,
        course_tee_id: teeId,
        override_hcp:  override,
      }, { onConflict: "event_id,player_id,course_tee_id", ignoreDuplicates: false });
    }
    revalidatePath(`/admin/events/${params.id}/teams/${params.teamId}`);
  }

  const event = team.events as { name: string; year: number } | null;
  const anyCalculated = Object.values(hcpMap).some((m) =>
    Object.values(m).some((h) => h.calculated !== null)
  );

  return (
    <div className="px-4 py-6 space-y-6">
      <Link href={`/admin/events/${params.id}`} className="text-sm text-navy/50 hover:text-navy">
        ← {event?.name ?? "Event"}
      </Link>

      <div className="flex items-center gap-3">
        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: team.color }} />
        <h1 className="text-2xl font-display font-bold text-navy">{team.name}</h1>
      </div>

      {/* Calculate button */}
      {tees.length > 0 && (
        <form action={calculateHandicaps}>
          <button type="submit"
            className="w-full rounded-lg border border-navy py-2 text-sm font-semibold text-navy hover:bg-navy hover:text-off-white transition-colors">
            {anyCalculated ? "Re-calculate All Handicaps" : "Calculate Handicaps"}
          </button>
        </form>
      )}

      {/* Roster */}
      <div className="space-y-3">
        <p className="text-sm font-semibold text-navy/60 uppercase tracking-wide">
          Roster · {roster?.length ?? 0} players
        </p>
        {roster?.length === 0 && <p className="text-sm text-navy/40">No players yet.</p>}

        {roster?.map((ep) => {
          const p = ep.players as { id: string; name: string; nickname: string | null; current_index: number | null } | null;
          const playerHcps = hcpMap[p?.id ?? ""] ?? {};

          return (
            <div key={ep.id} className="rounded-xl border border-hairline bg-white px-4 py-3 space-y-3">
              {/* Name row */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-navy">
                    {ep.display_name}
                    {ep.is_captain && <span className="ml-1.5 text-xs text-navy/40 font-normal">Captain</span>}
                  </p>
                  <p className="text-xs text-navy/40">
                    {p?.name} · index {formatHcp(p?.current_index)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <form action={toggleCaptain}>
                    <input type="hidden" name="ep_id" value={ep.id} />
                    <input type="hidden" name="is_captain" value={String(ep.is_captain)} />
                    <button type="submit" className="text-xs text-navy/50 hover:text-navy">
                      {ep.is_captain ? "Uncap" : "Cap"}
                    </button>
                  </form>
                  <DeleteButton
                    action={removePlayer}
                    fields={{ ep_id: ep.id }}
                    confirm={`Remove ${ep.display_name} from this team?`}
                    label="Remove"
                    className="text-xs text-usa-red hover:underline"
                  />
                </div>
              </div>

              {/* Handicaps per course tee */}
              {tees.length > 0 && p && (
                <form action={savePlayerHandicaps} className="space-y-2 border-t border-hairline pt-2">
                  <input type="hidden" name="player_id" value={p.id} />
                  <input type="hidden" name="tee_ids" value={tees.map((t) => t.id).join(",")} />
                  {tees.map((tee) => {
                    const hcp = playerHcps[tee.id];
                    const calc = hcp?.calculated;
                    const override = hcp?.override;
                    return (
                      <div key={tee.id} className="flex items-center gap-2">
                        <p className="text-xs text-navy/60 flex-1 truncate">
                          {tee.courses?.name} <span className="text-navy/30">({tee.tee_name})</span>
                        </p>
                        <span className="text-xs text-navy/30 w-16 text-right">
                          {calc != null ? `calc ${formatHcp(calc)}` : "no index"}
                        </span>
                        <input
                          name={`hcp_${tee.id}`}
                          type="text"
                          inputMode="numeric"
                          defaultValue={override != null ? formatHcp(override) : calc != null ? formatHcp(calc) : ""}
                          placeholder={calc != null ? formatHcp(calc) : "—"}
                          className={`w-14 rounded border px-2 py-1 text-center text-sm ${
                            override != null
                              ? "border-navy text-navy font-semibold"
                              : "border-hairline text-navy/60"
                          }`}
                        />
                      </div>
                    );
                  })}
                  <button type="submit"
                    className="text-xs text-navy/50 hover:text-navy underline">
                    Save handicaps
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>

      {/* Add player */}
      {available.length > 0 ? (
        <form action={addPlayer} className="rounded-xl border border-dashed border-hairline p-4 space-y-3">
          <p className="font-semibold text-navy text-sm">Add Player</p>
          <select name="player_id" required className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
            <option value="">Select player…</option>
            {available.map((ap) => (
              <option key={ap.id} value={ap.id}>
                {ap.name}{ap.nickname ? ` (${ap.nickname})` : ""} · {ap.current_index ?? "no index"}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-navy">
            <input type="checkbox" name="is_captain" /> Captain
          </label>
          <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
            Add to Roster
          </button>
        </form>
      ) : (
        <p className="text-sm text-navy/40">All players are already assigned to a team for this event.</p>
      )}
    </div>
  );
}
