import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { ErrorBanner } from "@/components/ErrorBanner";
import { DeleteButton } from "@/components/DeleteButton";
import { failTo } from "@/lib/actionError";
import { recordCtpEvent } from "@/lib/feed";

export default async function RoundEditPage({
  params,
  searchParams,
}: {
  params: { id: string; roundId: string };
  searchParams: { error?: string };
}) {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const supabase = createClient();

  const { data: roundRaw } = await supabase
    .from("rounds")
    .select("*, course_tees(id, tee_name, course_id, courses(name))")
    .eq("id", params.roundId)
    .single();
  if (!roundRaw) redirect(`/admin/events/${params.id}`);
  const round = roundRaw as unknown as {
    id: string; event_id: string; round_number: number; name: string | null;
    side: string; played_at: string | null; status: string;
    course_tee_id: string;
    format_id: string;
    course_tees: { id: string; tee_name: string; course_id: string; courses: { name: string } | null } | null;
  };

  // All tees for courses linked to this event
  const { data: eventCoursesRaw } = await supabase
    .from("event_courses")
    .select("course_id")
    .eq("event_id", params.id);
  const linkedCourseIds = (eventCoursesRaw ?? []).map((ec: { course_id: string }) => ec.course_id);

  const { data: teesRaw } = await supabase
    .from("course_tees")
    .select("id, tee_name, course_id, courses(name)")
    .in("course_id", linkedCourseIds.length > 0 ? linkedCourseIds : ["00000000-0000-0000-0000-000000000000"]);
  const tees = (teesRaw ?? []) as unknown as {
    id: string; tee_name: string; course_id: string; courses: { name: string } | null;
  }[];

  const { data: formats } = await supabase.from("formats").select("id, name").order("sort_order");

  // CTP holes for this round + the event field (for the holder picker)
  const { data: ctpRaw } = await supabase
    .from("ctp_holes")
    .select("id, hole_number, holder_participant_id, stake, bet_id")
    .eq("round_id", params.roundId)
    .order("hole_number");
  const ctpHoles = ctpRaw ?? [];
  const { data: eventRow } = await supabase
    .from("events").select("year").eq("id", params.id).single();
  const eventYear = eventRow?.year ?? new Date().getFullYear();
  const { data: fieldRaw } = await supabase
    .from("event_participants")
    .select("id, display_name")
    .eq("event_id", params.id)
    .order("display_name");
  const field = fieldRaw ?? [];

  // Valid hole numbers for this round's side
  const holeRange = round.side === "front" ? [1, 9] : round.side === "back" ? [10, 18] : [1, 18];

  async function addCtpHole(formData: FormData) {
    "use server";
    const supabase = createClient();
    const path = `/admin/events/${params.id}/rounds/${params.roundId}`;
    const hole = parseInt(formData.get("hole_number") as string);
    const lo = round.side === "front" ? 1 : round.side === "back" ? 10 : 1;
    const hi = round.side === "front" ? 9 : 18;
    if (!hole || hole < lo || hole > hi) {
      failTo(path, { message: `Hole must be between ${lo} and ${hi} for this round.` });
    }
    const stakeRaw = (formData.get("stake") as string || "").replace("$", "").trim();
    const stake = stakeRaw ? parseFloat(stakeRaw) : null;
    if (stakeRaw && (!stake || stake <= 0)) {
      failTo(path, { message: "Stake must be a positive dollar amount (or blank)." });
    }
    const { error } = await supabase.from("ctp_holes").insert({
      round_id: params.roundId,
      hole_number: hole,
      stake,
    });
    failTo(path, error);
    revalidatePath(path);
    revalidatePath("/matches");
  }

  async function setCtpStake(formData: FormData) {
    "use server";
    const supabase = createClient();
    const path = `/admin/events/${params.id}/rounds/${params.roundId}`;
    const stakeRaw = (formData.get("stake") as string || "").replace("$", "").trim();
    const stake = stakeRaw ? parseFloat(stakeRaw) : null;
    if (stakeRaw && (!stake || stake <= 0)) {
      failTo(path, { message: "Stake must be a positive dollar amount (or blank)." });
    }
    // Only while unsettled — the posted bet is the record after that.
    const { error } = await supabase.from("ctp_holes")
      .update({ stake })
      .eq("id", formData.get("ctp_id") as string)
      .is("bet_id", null);
    failTo(path, error);
    revalidatePath(path);
    revalidatePath("/matches");
  }

  // Settle a staked CTP into the betting ledger: an already-closed group bet
  // where everyone who played the round pays the stake and the holder takes
  // the pot. bet_id on the hole guards against posting twice.
  async function postCtpToLedger(formData: FormData) {
    "use server";
    const me = await requirePlayer();
    const supabase = createClient();
    const path = `/admin/events/${params.id}/rounds/${params.roundId}`;
    const ctpId = formData.get("ctp_id") as string;

    const { data: ctp } = await supabase
      .from("ctp_holes")
      .select("id, hole_number, stake, bet_id, holder_participant_id, event_participants(player_id, display_name)")
      .eq("id", ctpId).single();
    if (!ctp) { failTo(path, { message: "CTP hole not found." }); return; }
    if (ctp.bet_id) { failTo(path, { message: "Already posted to the ledger." }); return; }
    if (!ctp.stake) { failTo(path, { message: "Set a stake first." }); return; }
    const holder = ctp.event_participants as unknown as { player_id: string | null; display_name: string } | null;
    if (!holder?.player_id) { failTo(path, { message: "Set the winner before posting to the ledger." }); return; }

    // Everyone who played the round (distinct linked players in its matchups)
    const { data: ms } = await supabase
      .from("matchups")
      .select(`
        home_p1:event_participants!matchups_home_p1_id_fkey(player_id),
        home_p2:event_participants!matchups_home_p2_id_fkey(player_id),
        away_p1:event_participants!matchups_away_p1_id_fkey(player_id),
        away_p2:event_participants!matchups_away_p2_id_fkey(player_id)`)
      .eq("round_id", params.roundId);
    const playerIds = new Set<string>();
    for (const m of (ms ?? []) as unknown as Record<string, { player_id: string | null } | null>[]) {
      for (const key of ["home_p1", "home_p2", "away_p1", "away_p2"]) {
        const pid = m[key]?.player_id;
        if (pid) playerIds.add(pid);
      }
    }
    playerIds.add(holder.player_id); // belt & braces — winner is always in
    if (playerIds.size < 2) {
      failTo(path, { message: "No field to bet against — set the round's lineups first." });
      return;
    }

    const { data: bet, error: betError } = await supabase.from("bets").insert({
      year: eventYear,
      bet_type: "group",
      amount: ctp.stake,
      description: `CTP #${ctp.hole_number} · R${round.round_number}`,
      status: "closed",
      created_by: me.id,
      closed_by: me.id,
      closed_at: new Date().toISOString(),
    }).select("id").single();
    if (betError || !bet) { failTo(path, betError ?? { message: "Couldn't create the bet." }); return; }

    const { error: partsError } = await supabase.from("bet_participants").insert(
      Array.from(playerIds).map((pid) => ({
        bet_id: bet.id,
        player_id: pid,
        side: null,
        is_winner: pid === holder.player_id,
      })),
    );
    if (partsError) {
      await supabase.from("bets").delete().eq("id", bet.id); // no half-posted bets
      failTo(path, partsError);
      return;
    }

    const { error: linkError } = await supabase.from("ctp_holes")
      .update({ bet_id: bet.id }).eq("id", ctpId);
    failTo(path, linkError);

    await recordCtpEvent(supabase, params.id,
      `💰 CTP #${ctp.hole_number} pays out — ${holder.display_name} collects $${Number(ctp.stake)} a head`);

    revalidatePath(path);
    revalidatePath("/bets");
    revalidatePath("/");
  }

  async function setCtpHolder(formData: FormData) {
    "use server";
    const me = await requirePlayer();
    const supabase = createClient();
    const path = `/admin/events/${params.id}/rounds/${params.roundId}`;
    const holderId = (formData.get("holder") as string) || null;
    const ctpId = formData.get("ctp_id") as string;
    const { error } = await supabase.from("ctp_holes").update({
      holder_participant_id: holderId,
      holder_set_at: holderId ? new Date().toISOString() : null,
      holder_set_by: holderId ? me.id : null,
    }).eq("id", ctpId);
    failTo(path, error);
    if (holderId) {
      const { data: ctp } = await supabase
        .from("ctp_holes").select("hole_number, event_participants(display_name)").eq("id", ctpId).single();
      const name = (ctp?.event_participants as unknown as { display_name: string } | null)?.display_name;
      if (name) {
        await recordCtpEvent(supabase, params.id,
          `🎯 ${name} is closest on #${ctp!.hole_number} · R${round.round_number} (commissioner call)`);
      }
    }
    revalidatePath(path);
    revalidatePath("/matches");
    revalidatePath("/");
  }

  async function removeCtpHole(formData: FormData) {
    "use server";
    const supabase = createClient();
    const path = `/admin/events/${params.id}/rounds/${params.roundId}`;
    const { error } = await supabase.from("ctp_holes").delete().eq("id", formData.get("ctp_id") as string);
    failTo(path, error);
    revalidatePath(path);
    revalidatePath("/matches");
  }

  async function updateRound(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("rounds").update({
      course_tee_id: formData.get("course_tee_id") as string,
      format_id:     formData.get("format_id") as string,
      name:          formData.get("name") as string || null,
      side:          formData.get("side") as string,
      played_at:     formData.get("played_at") as string || null,
      status:        formData.get("status") as string,
    }).eq("id", params.roundId);
    failTo(`/admin/events/${params.id}/rounds/${params.roundId}`, error);
    revalidatePath(`/admin/events/${params.id}`);
    redirect(`/admin/events/${params.id}`);
  }

  return (
    <div className="px-4 py-6 space-y-6">
      <Link href={`/admin/events/${params.id}`} className="text-sm text-navy/50 hover:text-navy">
        ← Event
      </Link>
      <h1 className="text-2xl font-display font-bold text-navy">
        Round {round.round_number}
      </h1>
      <ErrorBanner message={searchParams.error} />

      <form action={updateRound} className="space-y-3">
        <input name="name" defaultValue={round.name ?? ""} placeholder="Label (optional, e.g. Morning)"
          className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <select name="course_tee_id" required defaultValue={round.course_tee_id}
          className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
          {tees.map((t) => (
            <option key={t.id} value={t.id}>{t.courses?.name} — {t.tee_name} Tees</option>
          ))}
        </select>
        <select name="format_id" required defaultValue={round.format_id}
          className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
          {(formats ?? []).map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <select name="side" required defaultValue={round.side}
            className="flex-1 rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
            <option value="full">Full 18</option>
            <option value="front">Front 9</option>
            <option value="back">Back 9</option>
          </select>
          <input name="played_at" type="date" defaultValue={round.played_at ?? ""}
            className="flex-1 rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        </div>
        <select name="status" required defaultValue={round.status}
          className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
          <option value="pending">Pending</option>
          <option value="active">Active</option>
          <option value="complete">Complete</option>
        </select>
        <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
          Save Changes
        </button>
      </form>

      {/* Closest to the Pin */}
      <div className="space-y-3">
        <p className="font-semibold text-navy">🎯 Closest to the Pin</p>
        <p className="text-sm text-navy/50 -mt-2">
          Players claim these on the Matches page during the round — newest claim
          holds it. Set or clear the holder here if the group needs a ruling.
        </p>

        {ctpHoles.map((c) => (
          <div key={c.id} className="rounded-xl border border-hairline bg-white px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-navy">
                Hole {c.hole_number}
                {c.stake != null && (
                  <span className="ml-2 rounded-full bg-gold/20 px-2 py-0.5 text-xs font-bold text-navy/70">
                    ${Number(c.stake)} a head
                  </span>
                )}
              </p>
              <DeleteButton
                action={removeCtpHole}
                fields={{ ctp_id: c.id }}
                confirm={`Remove CTP on hole ${c.hole_number}?${c.bet_id ? " The posted bet stays on the ledger." : ""}`}
                label="Remove"
                className="text-xs text-usa-red hover:underline"
              />
            </div>
            <form action={setCtpHolder} className="flex items-center gap-2">
              <input type="hidden" name="ctp_id" value={c.id} />
              <select name="holder" defaultValue={c.holder_participant_id ?? ""}
                className="flex-1 rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
                <option value="">— unclaimed —</option>
                {field.map((p) => (
                  <option key={p.id} value={p.id}>{p.display_name}</option>
                ))}
              </select>
              <button type="submit" className="shrink-0 text-xs text-navy/50 hover:text-navy underline">
                Save holder
              </button>
            </form>
            {c.bet_id ? (
              <p className="rounded-lg bg-europe-green/10 px-3 py-2 text-xs font-semibold text-europe-green">
                ✓ Settled to the betting ledger
              </p>
            ) : (
              <div className="flex items-center gap-2 border-t border-hairline pt-2">
                <form action={setCtpStake} className="flex flex-1 items-center gap-2">
                  <input type="hidden" name="ctp_id" value={c.id} />
                  <input
                    name="stake" type="text" inputMode="decimal"
                    defaultValue={c.stake != null ? String(Number(c.stake)) : ""}
                    placeholder="$ per player"
                    className="w-28 rounded-lg border border-hairline px-3 py-1.5 text-sm text-navy"
                  />
                  <button type="submit" className="shrink-0 text-xs text-navy/50 hover:text-navy underline">
                    Save stake
                  </button>
                </form>
                {c.stake != null && c.holder_participant_id && (
                  <form action={postCtpToLedger}>
                    <input type="hidden" name="ctp_id" value={c.id} />
                    <button type="submit"
                      className="shrink-0 rounded-lg bg-europe-green px-3 py-1.5 text-xs font-bold text-white">
                      💰 Post to ledger
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        ))}
        {ctpHoles.length === 0 && (
          <p className="text-sm text-navy/40">No CTP holes yet.</p>
        )}

        <form action={addCtpHole} className="flex items-center gap-2 rounded-xl border border-dashed border-hairline p-3">
          <input
            name="hole_number"
            type="number"
            min={holeRange[0]}
            max={holeRange[1]}
            required
            placeholder={`Hole (${holeRange[0]}–${holeRange[1]})`}
            className="flex-1 rounded-lg border border-hairline px-3 py-2 text-sm text-navy"
          />
          <input
            name="stake"
            type="text"
            inputMode="decimal"
            placeholder="$ (optional)"
            className="w-28 rounded-lg border border-hairline px-3 py-2 text-sm text-navy"
          />
          <button type="submit" className="shrink-0 rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-off-white">
            Add CTP Hole
          </button>
        </form>
        <p className="text-xs text-navy/40 -mt-1">
          With a stake, everyone who plays the round is in: losers each pay it, the
          winner collects. Post it to the betting ledger here once the round settles.
        </p>
      </div>
    </div>
  );
}
