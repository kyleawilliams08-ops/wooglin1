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
    const name  = formData.get("name") as string;
    const email = formData.get("email") as string;
    const index = formData.get("index") as string;
    const role  = formData.get("role") as string;

    await supabase.from("players").insert({
      name,
      email,
      current_index: index ? parseFloat(index) : null,
      role,
    });
    revalidatePath("/admin/players");
  }

  return (
    <div className="px-4 py-6 space-y-6">
      <h1 className="text-2xl font-display font-bold text-navy">Players</h1>

      {/* Add player form */}
      <form action={addPlayer} className="rounded-xl border border-hairline bg-parchment p-4 space-y-3">
        <p className="font-semibold text-navy text-sm">Add Player</p>
        <input name="name"  required placeholder="Full name"  className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="email" required placeholder="Email"  type="email" className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
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

      {/* Player list */}
      <ul className="space-y-2">
        {players?.map((p) => (
          <li key={p.id} className="flex items-center justify-between rounded-xl border border-hairline bg-white px-4 py-3">
            <div>
              <p className="font-semibold text-navy">{p.name}</p>
              <p className="text-xs text-navy/50">{p.email}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-navy">{p.current_index != null ? `+${p.current_index}` : "—"}</p>
              <p className="text-xs text-navy/50 uppercase">{p.role}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
