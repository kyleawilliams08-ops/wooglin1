"use server";

import { requirePlayer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * Acknowledge an admin alert for the signed-in player. Returns the error
 * message instead of throwing — thrown server-action errors are masked in
 * production, and the overlay needs to show the real reason.
 */
export async function dismissAlert(alertId: string): Promise<{ error: string | null }> {
  const player = await requirePlayer();
  const supabase = createClient();
  const { error } = await supabase
    .from("alert_dismissals")
    .upsert(
      { alert_id: alertId, player_id: player.id },
      { onConflict: "alert_id,player_id", ignoreDuplicates: true },
    );
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { error: null };
}
