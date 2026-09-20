"use server";

import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

  const { data: ctp } = await supabase
    .from("ctp_holes")
    .select("id, hole_number, holder_participant_id, bet_id, rounds(id, event_id, round_number)")
    .eq("id", ctpId).single();
  const round = (ctp?.rounds ?? null) as unknown as { id: string; event_id: string; round_number: number } | null;
  const back = round ? `/matches?round=${round.id}` : "/matches";
  if (!ctp || !round) { failTo("/matches", { message: "CTP hole not found." }); return; }
  // Once the pot is on the ledger the hole is settled — a late claim would
  // change the holder after someone else has already been paid.
  if (ctp.bet_id) { failTo(back, { message: `CTP #${ctp.hole_number} has already been paid out.` }); return; }

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

  // Claim chain history — best-effort; a history hiccup must not block the claim.
  await supabase.from("ctp_claims").insert({
    ctp_id: ctpId,
    participant_id: myPart.id,
    claimed_by: player.id,
  });

  const name = (myPart.players as unknown as { nickname: string | null } | null)?.nickname ?? myPart.display_name;
  await recordCtpEvent(supabase, round.event_id,
    `🎯 ${name} is closest on #${ctp.hole_number} · R${round.round_number}`);

  revalidatePath("/matches");
  revalidatePath("/");
}


/**
 * Settle a staked CTP into the betting ledger: an already-closed group bet
 * where everyone who played the round pays the stake and the holder takes the
 * pot. Commissioner only. `bet_id` on the hole guards against posting twice.
 * Shared by the round admin page and the CTP strip on /matches — the form's
 * hidden `return_to` says where to land (and where errors bounce).
 */
export async function postCtpToLedger(formData: FormData): Promise<void> {
  const me = await requirePlayer();
  const supabase = createClient();
  const ctpId = formData.get("ctp_id") as string;
  const wanted = (formData.get("return_to") as string) || "/matches";
  const back = wanted.startsWith("/") && !wanted.startsWith("//") ? wanted : "/matches"; // same-site only
  if (!isAdmin(me)) { failTo(back, { message: "Only the commissioner can post a CTP to the ledger." }); return; }

  const { data: ctp } = await supabase
    .from("ctp_holes")
    .select("id, round_id, hole_number, stake, bet_id, holder_participant_id, event_participants(player_id, display_name), rounds(event_id, round_number)")
    .eq("id", ctpId).single();
  if (!ctp) { failTo(back, { message: "CTP hole not found." }); return; }
  if (ctp.bet_id) { failTo(back, { message: "Already posted to the ledger." }); return; }
  if (!ctp.stake) { failTo(back, { message: "Set a stake first (round Edit → CTP)." }); return; }
  const holder = ctp.event_participants as unknown as { player_id: string | null; display_name: string } | null;
  if (!holder?.player_id) { failTo(back, { message: "Nobody has claimed this CTP yet — set the winner first." }); return; }
  const round = ctp.rounds as unknown as { event_id: string; round_number: number } | null;
  if (!round) { failTo(back, { message: "Round not found." }); return; }

  // Everyone who played the round (distinct linked players in its matchups)
  const { data: ms } = await supabase
    .from("matchups")
    .select(`
      home_p1:event_participants!matchups_home_p1_id_fkey(player_id),
      home_p2:event_participants!matchups_home_p2_id_fkey(player_id),
      away_p1:event_participants!matchups_away_p1_id_fkey(player_id),
      away_p2:event_participants!matchups_away_p2_id_fkey(player_id)`)
    .eq("round_id", ctp.round_id);
  const playerIds = new Set<string>();
  for (const m of (ms ?? []) as unknown as Record<string, { player_id: string | null } | null>[]) {
    for (const key of ["home_p1", "home_p2", "away_p1", "away_p2"]) {
      const pid = m[key]?.player_id;
      if (pid) playerIds.add(pid);
    }
  }
  playerIds.add(holder.player_id); // belt & braces — winner is always in
  if (playerIds.size < 2) {
    failTo(back, { message: "No field to bet against — set the round's lineups first." });
    return;
  }

  // Current calendar year, matching the bet wizard — the ledger and Bets tab
  // filter on it, so an event with a backfilled/test year would otherwise
  // file the bet where nobody can see it.
  const { data: bet, error: betError } = await supabase.from("bets").insert({
    year: new Date().getFullYear(),
    bet_type: "group",
    amount: ctp.stake,
    description: `CTP #${ctp.hole_number} · R${round.round_number}`,
    status: "closed",
    created_by: me.id,
    closed_by: me.id,
    closed_at: new Date().toISOString(),
  }).select("id").single();
  if (betError || !bet) { failTo(back, betError ?? { message: "Couldn't create the bet." }); return; }

  const { error: partsError } = await supabase.from("bet_participants").insert(
    Array.from(playerIds).map((pid) => ({
      bet_id: bet.id, player_id: pid, side: null, is_winner: pid === holder.player_id,
    })),
  );
  if (partsError) {
    await supabase.from("bets").delete().eq("id", bet.id); // no half-posted bets
    failTo(back, partsError);
    return;
  }

  // bet_id IS NULL in the WHERE: if two admins tap at once, only one links —
  // the other's bet is rolled back instead of double-charging the field.
  const { data: linked, error: linkError } = await supabase.from("ctp_holes")
    .update({ bet_id: bet.id }).eq("id", ctpId).is("bet_id", null).select("id");
  if (linkError || (linked?.length ?? 0) === 0) {
    await supabase.from("bets").delete().eq("id", bet.id);
    failTo(back, linkError ?? { message: "Already posted to the ledger." });
    return;
  }

  await recordCtpEvent(supabase, round.event_id,
    `💰 CTP #${ctp.hole_number} pays out — ${holder.display_name} collects $${Number(ctp.stake)} a head`);

  revalidatePath("/matches");
  revalidatePath("/bets");
  revalidatePath("/");
  redirect(`${back}${back.includes("?") ? "&" : "?"}saved=1`);
}
