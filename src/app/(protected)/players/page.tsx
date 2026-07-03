import { requirePlayer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PlayerDirectory, type DirectoryPlayer } from "@/components/PlayerDirectory";

export default async function PlayersPage() {
  await requirePlayer();
  const supabase = createClient();
  const { data: players } = await supabase
    .from("players")
    .select("*")
    .order("name");

  // Aggregate cup history for the summary line on each row
  const { data: apps } = await supabase
    .from("player_appearances")
    .select("player_id, result");
  const summary = new Map<string, { n: number; w: number; l: number; t: number }>();
  for (const a of apps ?? []) {
    const s = summary.get(a.player_id) ?? { n: 0, w: 0, l: 0, t: 0 };
    s.n++;
    if (a.result === "W") s.w++;
    else if (a.result === "L") s.l++;
    else s.t++;
    summary.set(a.player_id, s);
  }

  const directory: DirectoryPlayer[] = (players ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    nickname: p.nickname,
    current_index: p.current_index,
    avatar_url: p.avatar_url,
    summary: summary.get(p.id) ?? null,
  }));

  return (
    <div className="px-4 py-6 space-y-4">
      <h1 className="text-2xl font-display font-bold text-navy">Player Cards</h1>
      <PlayerDirectory players={directory} />
    </div>
  );
}
