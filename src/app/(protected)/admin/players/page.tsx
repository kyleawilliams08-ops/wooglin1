import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { parseHcpInput } from "@/lib/handicap";
import { PlayerList } from "./PlayerList";
import { ErrorBanner } from "@/components/ErrorBanner";
import { failTo } from "@/lib/actionError";

export default async function AdminPlayersPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
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
    const { error } = await supabase.from("players").insert({
      name:          formData.get("name") as string,
      nickname:      (formData.get("nickname") as string) || null,
      email:         formData.get("email") as string,
      current_index: parseHcpInput((formData.get("index") as string) ?? ""),
      role:          formData.get("role") as string,
    });
    failTo("/admin/players", error);
    revalidatePath("/admin/players");
    redirect("/admin/players?saved=1");
  }

  async function updatePlayer(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("players").update({
      name:          formData.get("name") as string,
      nickname:      (formData.get("nickname") as string) || null,
      email:         formData.get("email") as string,
      current_index: parseHcpInput((formData.get("index") as string) ?? ""),
      role:          formData.get("role") as string,
    }).eq("id", formData.get("id") as string);
    failTo("/admin/players", error);
    revalidatePath("/admin/players");
    redirect("/admin/players?saved=1");
  }

  async function deletePlayer(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("players").delete().eq("id", formData.get("id") as string);
    failTo("/admin/players", error);
    revalidatePath("/admin/players");
  }

  return (
    <div className="px-4 py-6 space-y-6">
      <h1 className="text-2xl font-display font-bold text-navy">Players</h1>
      <ErrorBanner message={searchParams.error} />

      {/* Add player */}
      <form action={addPlayer} className="rounded-xl border border-hairline bg-parchment p-4 space-y-3">
        <p className="font-semibold text-navy text-sm">Add Player</p>
        <input name="name"  required placeholder="Full name"  className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="nickname" placeholder="Nickname (shows on player card)" className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="email" required placeholder="Email" type="email" className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="index" placeholder="USGA Index — use +2.0 for plus handicaps" type="text" inputMode="decimal" className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <select name="role" className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
          <option value="player">Player</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
          Add Player
        </button>
      </form>

      <PlayerList
        players={players ?? []}
        updatePlayer={updatePlayer}
        deletePlayer={deletePlayer}
      />
    </div>
  );
}
