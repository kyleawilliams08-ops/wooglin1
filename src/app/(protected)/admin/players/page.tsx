import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export default async function AdminPlayersPage() {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const supabase = createClient();
  const { data: players } = await supabase
    .from("players")
    .select("*")
    .order("name");

  async function addPlayer(formData: FormData) {
    "use server";
    const supabase = createClient();
    await supabase.from("players").insert({
      name:          formData.get("name") as string,
      email:         formData.get("email") as string,
      current_index: formData.get("index") ? parseFloat(formData.get("index") as string) : null,
      role:          formData.get("role") as string,
    });
    revalidatePath("/admin/players");
  }

  async function updatePlayer(formData: FormData) {
    "use server";
    const supabase = createClient();
    await supabase.from("players").update({
      email: formData.get("email") as string,
      role:  formData.get("role") as string,
    }).eq("id", formData.get("id") as string);
    revalidatePath("/admin/players");
  }

  return (
    <div className="px-4 py-6 space-y-6">
      <h1 className="text-2xl font-display font-bold text-navy">Players</h1>

      {/* Add player form */}
      <form action={addPlayer} className="rounded-xl border border-hairline bg-parchment p-4 space-y-3">
        <p className="font-semibold text-navy text-sm">Add Player</p>
        <input name="name"  required placeholder="Full name" className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="email" required placeholder="Email" type="email" className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="index" placeholder="USGA Index (optional)" type="number" step="0.1" className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <select name="role" className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
          <option value="player">Player</option>
          <option value="captain">Captain</option>
          <option value="assistant">Assistant</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
          Add Player
        </button>
      </form>

      {/* Player list with inline edit */}
      <ul className="space-y-2">
        {players?.map((p) => (
          <li key={p.id} className="rounded-xl border border-hairline bg-white px-4 py-3 space-y-2">
            <p className="font-semibold text-navy">{p.name}</p>
            <form action={updatePlayer} className="space-y-2">
              <input type="hidden" name="id" value={p.id} />
              <input
                name="email"
                type="email"
                required
                defaultValue={p.email}
                className="w-full rounded-lg border border-hairline px-3 py-1.5 text-sm text-navy"
              />
              <div className="flex gap-2">
                <select
                  name="role"
                  defaultValue={p.role}
                  className="flex-1 rounded-lg border border-hairline px-3 py-1.5 text-sm text-navy bg-white"
                >
                  <option value="player">Player</option>
                  <option value="captain">Captain</option>
                  <option value="assistant">Assistant</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  type="submit"
                  className="rounded-lg bg-navy px-3 py-1.5 text-sm font-semibold text-off-white"
                >
                  Save
                </button>
              </div>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
