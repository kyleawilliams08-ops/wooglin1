import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

/** Cookie holding the player id an admin is "viewing as" (see Test Lab). */
export const MASQ_COOKIE = "wc_masq";

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
  /** Set when an admin is viewing the app AS this player (Test Lab). */
  masqueradedBy?: { id: string; name: string };
}

/**
 * The player the app should behave as: normally the signed-in player, but an
 * ADMIN with the masquerade cookie set gets the player they're viewing as.
 *
 * Safety: the cookie is only honored after the REAL signed-in user is
 * confirmed admin, server-side, on every request — anyone else setting it
 * gets nothing. The Supabase session never changes, so RLS still evaluates as
 * the real admin (a superset of any player); masquerade changes what the app
 * shows and how its own permission checks answer, never DB privileges.
 */
export async function requirePlayer(): Promise<Player> {
  const real = await requireRealPlayer();
  if (!isAdmin(real)) return real;

  const targetId = cookies().get(MASQ_COOKIE)?.value;
  if (!targetId || targetId === real.id) return real;

  const supabase = createClient();
  const { data: target } = await supabase
    .from("players").select("*").eq("id", targetId).maybeSingle();
  if (!target) return real; // stale cookie (player deleted) — ignore it
  return { ...(target as Player), masqueradedBy: { id: real.id, name: real.nickname ?? real.name } };
}

/** The actual signed-in player, ignoring any masquerade. Redirects to /login. */
export async function requireRealPlayer(): Promise<Player> {
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
