// Server-side scoring helpers shared by the full scorecard and the
// hole-by-hole scorer. Authorization mirrors the RLS policies.

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export type SlotKey = "hp1" | "hp2" | "ap1" | "ap2";

const SLOT_COLUMNS: Record<SlotKey, string> = {
  hp1: "home_p1_gross",
  hp2: "home_p2_gross",
  ap1: "away_p1_gross",
  ap2: "away_p2_gross",
};

/**
 * Server-side authorization for scoring actions: admins/assistants, or any
 * player who is IN the match (the architecture's scoring exception).
 * Throws if not allowed.
 */
export async function assertCanScore(matchupId: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: player } = await supabase
    .from("players").select("id, role").eq("auth_user_id", user.id).single();
  if (!player) redirect("/login");
  if (player.role === "admin" || player.role === "assistant") return;

  const { data: m } = await supabase
    .from("matchups")
    .select("home_p1_id, home_p2_id, away_p1_id, away_p2_id")
    .eq("id", matchupId)
    .single();
  const epIds = [m?.home_p1_id, m?.home_p2_id, m?.away_p1_id, m?.away_p2_id].filter(Boolean) as string[];
  if (epIds.length === 0) throw new Error("Not authorized to score this match");

  const { data: eps } = await supabase
    .from("event_participants").select("player_id").in("id", epIds);
  if (!eps?.some((ep) => ep.player_id === player.id)) {
    throw new Error("Not authorized to score this match");
  }
}

/** Upsert the whole grid of gross scores from the scorecard form. */
export async function upsertHoleScores(
  supabase: ReturnType<typeof createClient>,
  matchupId: string,
  formData: FormData,
) {
  const nums = (formData.get("hole_numbers") as string).split(",").map(Number);
  for (const n of nums) {
    const parse = (key: string) => {
      const v = formData.get(key) as string;
      return v !== "" ? parseInt(v) : null;
    };
    await supabase.from("hole_scores").upsert({
      matchup_id:    matchupId,
      hole_number:   n,
      home_p1_gross: parse(`hp1_${n}`),
      home_p2_gross: parse(`hp2_${n}`),
      away_p1_gross: parse(`ap1_${n}`),
      away_p2_gross: parse(`ap2_${n}`),
    }, { onConflict: "matchup_id,hole_number", ignoreDuplicates: false });
  }
}

/** Upsert a single ball's score on a single hole (hole-by-hole scorer). */
export async function upsertSingleScore(
  supabase: ReturnType<typeof createClient>,
  matchupId: string,
  holeNumber: number,
  slot: SlotKey,
  value: number | null,
) {
  const col = SLOT_COLUMNS[slot];
  if (!col) throw new Error(`Unknown score slot: ${slot}`);

  const { data: existing } = await supabase
    .from("hole_scores")
    .select("home_p1_gross, home_p2_gross, away_p1_gross, away_p2_gross")
    .eq("matchup_id", matchupId)
    .eq("hole_number", holeNumber)
    .maybeSingle();

  await supabase.from("hole_scores").upsert({
    matchup_id:    matchupId,
    hole_number:   holeNumber,
    home_p1_gross: existing?.home_p1_gross ?? null,
    home_p2_gross: existing?.home_p2_gross ?? null,
    away_p1_gross: existing?.away_p1_gross ?? null,
    away_p2_gross: existing?.away_p2_gross ?? null,
    [col]: value,
  }, { onConflict: "matchup_id,hole_number", ignoreDuplicates: false });
}
