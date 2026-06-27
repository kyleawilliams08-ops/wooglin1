import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export default async function AdminTeamsPage() {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const supabase = createClient();

  const { data: events } = await supabase
    .from("events")
    .select("id, name, year")
    .order("year", { ascending: false });

  const { data: teams } = await supabase
    .from("teams")
    .select("*, events(name, year)")
    .order("name");

  const { data: participants } = await supabase
    .from("event_participants")
    .select("*, players(name, nickname, current_index), teams(name, color)");

  async function addToTeam(formData: FormData) {
    "use server";
    const supabase = createClient();
    await supabase.from("event_participants").insert({
      event_id:     formData.get("event_id") as string,
      player_id:    formData.get("player_id") as string,
      team_id:      formData.get("team_id") as string,
      display_name: formData.get("display_name") as string,
      is_captain:   formData.get("is_captain") === "true",
    });
    revalidatePath("/admin/teams");
  }

  const { data: players } = await supabase.from("players").select("id, name, nickname").order("name");

  return (
    <div className="px-4 py-6 space-y-6">
      <h1 className="text-2xl font-display font-bold text-navy">Teams &amp; Rosters</h1>

      {teams?.map((team) => {
        const roster = participants?.filter((p) => p.team_id === team.id) ?? [];
        return (
          <div key={team.id} className="rounded-xl border border-hairline overflow-hidden">
            <div
              className="px-4 py-3 text-off-white font-display font-semibold"
              style={{ backgroundColor: team.color }}
            >
              {team.name} · {(team.events as { year: number } | null)?.year}
            </div>
            <ul className="divide-y divide-hairline bg-white">
              {roster.map((ep) => (
                <li key={ep.id} className="flex items-center justify-between px-4 py-2">
                  <span className="text-sm text-navy">
                    {ep.display_name}
                    {ep.is_captain && <span className="ml-1 text-xs text-navy/40">©</span>}
                  </span>
                  <span className="text-xs text-navy/40">
                    {(ep.players as { current_index: number | null } | null)?.current_index ?? "—"}
                  </span>
                </li>
              ))}
              {roster.length === 0 && (
                <li className="px-4 py-2 text-sm text-navy/40">No players yet</li>
              )}
            </ul>
          </div>
        );
      })}

      {/* Add participant form */}
      <form action={addToTeam} className="rounded-xl border border-hairline bg-parchment p-4 space-y-3">
        <p className="font-semibold text-navy text-sm">Add Player to Team</p>
        <select name="event_id" required className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
          <option value="">Select event…</option>
          {events?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select name="player_id" required className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
          <option value="">Select player…</option>
          {players?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select name="team_id" required className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
          <option value="">Select team…</option>
          {teams?.map((t) => <option key={t.id} value={t.id}>{t.name} ({(t.events as { year: number } | null)?.year})</option>)}
        </select>
        <input name="display_name" required placeholder="Display name" className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <label className="flex items-center gap-2 text-sm text-navy">
          <input type="checkbox" name="is_captain" value="true" /> Captain
        </label>
        <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
          Add to Team
        </button>
      </form>
    </div>
  );
}
