import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";

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

  // Players not already on any team for this event
  const { data: allPlayers } = await supabase.from("players").select("id, name, nickname, current_index").order("name");
  const { data: taken } = await supabase
    .from("event_participants")
    .select("player_id")
    .eq("event_id", params.id);
  const takenIds = new Set(taken?.map((t) => t.player_id));
  const available = allPlayers?.filter((p) => !takenIds.has(p.id)) ?? [];

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

  const event = team.events as { name: string; year: number } | null;

  return (
    <div className="px-4 py-6 space-y-6">
      <Link href={`/admin/events/${params.id}`} className="text-sm text-navy/50 hover:text-navy">
        ← {event?.name ?? "Event"}
      </Link>

      {/* Team header */}
      <div className="flex items-center gap-3">
        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: team.color }} />
        <h1 className="text-2xl font-display font-bold text-navy">{team.name}</h1>
      </div>

      {/* Current roster */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-navy/60 uppercase tracking-wide">
          Roster · {roster?.length ?? 0} players
        </p>
        {roster?.length === 0 && (
          <p className="text-sm text-navy/40">No players yet.</p>
        )}
        {roster?.map((ep) => {
          const p = ep.players as { name: string; nickname: string | null; current_index: number | null } | null;
          return (
            <div key={ep.id} className="flex items-center justify-between rounded-xl border border-hairline bg-white px-4 py-3">
              <div>
                <p className="font-semibold text-navy">
                  {ep.display_name}
                  {ep.is_captain && <span className="ml-1.5 text-xs text-navy/40 font-normal">Captain</span>}
                </p>
                <p className="text-xs text-navy/40">{p?.name} · index {p?.current_index ?? "—"}</p>
              </div>
              <div className="flex items-center gap-2">
                <form action={toggleCaptain}>
                  <input type="hidden" name="ep_id" value={ep.id} />
                  <input type="hidden" name="is_captain" value={String(ep.is_captain)} />
                  <button type="submit" className="text-xs text-navy/50 hover:text-navy">
                    {ep.is_captain ? "Uncap" : "Cap"}
                  </button>
                </form>
                <form action={removePlayer}>
                  <input type="hidden" name="ep_id" value={ep.id} />
                  <button type="submit" className="text-xs text-usa-red hover:underline">Remove</button>
                </form>
              </div>
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
            {available.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.nickname ? ` (${p.nickname})` : ""} · {p.current_index ?? "no index"}
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
