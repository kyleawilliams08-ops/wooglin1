"use server";

import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { failTo } from "@/lib/actionError";
import { recordCtpEvent } from "@/lib/feed";

/**
 * "I'm closest" — the signed-in player takes over a CTP hole. King of the
 * hill: the newest claim simply replaces the holder, and the final holder
 * when the round wraps is the winner. Form action from the Matches page
 * (hidden ctp_id), so errors bounce back through ?error= + ErrorBanner.
 *
 * Guards: caller must be a participant in the event, and claims lock once
 * every match in the round is complete (admins can still correct from the
 * round admin page).
 */
export async function claimCtp(formData: FormData): Promise<void> {
  const player = await requirePlayer();
  const supabase = createClient();
  const ctpId = formData.get("ctp_id") as string;
  const day = (formData.get("day") as string) || "";
  const back = day ? `/matches?day=${encodeURIComponent(day)}` : "/matches";

  const { data: ctp } = await supabase
    .from("ctp_holes")
    .select("id, hole_number, holder_participant_id, rounds(id, event_id, round_number)")
    .eq("id", ctpId).single();
  const round = (ctp?.rounds ?? null) as unknown as { id: string; event_id: string; round_number: number } | null;
  if (!ctp || !round) { failTo(back, { message: "CTP hole not found." }); return; }

  const { data: me } = await supabase
    .from("event_participants")
    .select("id, display_name, players(nickname)")
    .eq("event_id", round.event_id).eq("player_id", player.id)
    .limit(1);
  const myPart = me?.[0];
  if (!myPart) { failTo(back, { message: "You're not in this event's field." }); return; }

  if (!isAdmin(player)) {
    const { data: ms } = await supabase
      .from("matchups").select("status").eq("round_id", round.id);
    const roundDone = (ms?.length ?? 0) > 0 && (ms ?? []).every((m) => m.status === "complete");
    if (roundDone) {
      failTo(back, { message: "That round is finished — ask the commissioner to correct CTP." });
      return;
    }
  }

  if (ctp.holder_participant_id === myPart.id) return; // already yours

  const { error } = await supabase.from("ctp_holes").update({
    holder_participant_id: myPart.id,
    holder_set_at: new Date().toISOString(),
    holder_set_by: player.id,
  }).eq("id", ctpId);
  failTo(back, error);

  const name = (myPart.players as unknown as { nickname: string | null } | null)?.nickname ?? myPart.display_name;
  await recordCtpEvent(supabase, round.event_id,
    `🎯 ${name} is closest on #${ctp.hole_number} · R${round.round_number}`);

  revalidatePath("/matches");
  revalidatePath("/");
}
