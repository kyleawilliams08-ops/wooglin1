import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export type PlayerRole = "admin" | "assistant" | "captain" | "player";

export interface Player {
  id: string;
  auth_user_id: string;
  name: string;
  nickname: string | null;
  email: string;
  avatar_url: string | null;
  current_index: number | null;
  ghin_id: string | null;
  role: PlayerRole;
  created_at: string;
}

/** Returns the current player row, or redirects to /login. */
export async function requirePlayer(): Promise<Player> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: player } = await supabase
    .from("players")
    .select("*")
    .eq("auth_user_id", user.id)
    .single();

  // Authenticated but no linked player row: send to login WITH an error flag.
  // A bare /login would bounce straight back here (middleware sees the
  // session) and loop forever — the flag both breaks the loop and surfaces
  // the actual problem.
  if (!player) redirect("/login?error=unlinked");
  return player as Player;
}

/** Returns true if the player has admin or assistant role. */
export function isAdmin(player: Player) {
  return player.role === "admin" || player.role === "assistant";
}
