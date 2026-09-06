import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { DeleteButton } from "@/components/DeleteButton";
import { ConfirmForm } from "@/components/ConfirmForm";
import { ErrorBanner } from "@/components/ErrorBanner";
import { failTo } from "@/lib/actionError";
import { startLineupDraft } from "@/lib/lineupDraftActions";

export default async function MatchupsPage({
  params,
  searchParams,
}: {
  params: { id: string; roundId: string };
  searchParams: { error?: string; copied?: string };
}) {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const supabase = createClient();

  const { data: roundRaw } = await supabase
    .from("rounds")
    .select("id, round_number, name, side, formats(id, name, team_size), course_tees(tee_name, courses(name))")
    .eq("id", params.roundId)
    .single();
  const round = roundRaw as unknown as {
    id: string; round_number: number; name: string | null; side: string;
    formats: { id: string; name: string; team_size: number | null } | null;
    course_tees: { tee_name: string; courses: { name: string } | null } | null;
  } | null;
  if (!round) redirect(`/admin/events/${params.id}`);

  const isSingles = round.formats?.name === "Singles";
  const sideLabel: Record<string, string> = { front: "Front 9", back: "Back 9", full: "Full 18" };

  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, color")
    .eq("event_id", params.id)
    .order("name");

  const homeTeam = teams?.[0] ?? null;
  const awayTeam = teams?.[1] ?? null;

  const { data: participantsRaw } = await supabase
    .from("event_participants")
    .select("id, display_name, team_id")
    .eq("event_id", params.id)
    .order("display_name");
  const participants = participantsRaw ?? [];

  const homePlayers = participants.filter((p) => p.team_id === homeTeam?.id);
  const awayPlayers = participants.filter((p) => p.team_id === awayTeam?.id);

  const { data: matchupsRaw } = await supabase
    .from("matchups")
    .select(`
      id, match_number, status, result, tee_time, match_score,
      formats(name),
      home_p1:event_participants!matchups_home_p1_id_fkey(id, display_name),
      home_p2:event_participants!matchups_home_p2_id_fkey(id, display_name),
      away_p1:event_participants!matchups_away_p1_id_fkey(id, display_name),
      away_p2:event_participants!matchups_away_p2_id_fkey(id, display_name)
    `)
    .eq("round_id", params.roundId)
    .order("tee_time", { ascending: true, nullsFirst: false })
    .order("match_number");
  const matchups = (matchupsRaw ?? []) as unknown as {
    id: string; match_number: number; status: string; result: string | null;
    tee_time: string | null; match_score: string | null;
    formats: { name: string } | null; // per-match override (null = round default)
    home_p1: { id: string; display_name: string } | null;
    home_p2: { id: string; display_name: string } | null;
    away_p1: { id: string; display_name: string } | null;
    away_p2: { id: string; display_name: string } | null;
  }[];

  const usedIds = new Set(
    matchups.flatMap((m) =>
      [m.home_p1?.id, m.home_p2?.id, m.away_p1?.id, m.away_p2?.id].filter(Boolean)
    )
  );
  const availableHome = homePlayers.filter((p) => !usedIds.has(p.id));
  const availableAway = awayPlayers.filter((p) => !usedIds.has(p.id));

  // Optional lineup draft for this round (fills the matchups snake-style)
  const { data: lineupDraft } = await supabase
    .from("lineup_drafts").select("*").eq("round_id", params.roundId).maybeSingle();
  const { count: lineupPickCount } = lineupDraft
    ? await supabase.from("lineup_draft_picks").select("*", { count: "exact", head: true }).eq("draft_id", lineupDraft.id)
    : { count: 0 };
  const roundUnderway = matchups.some((m) => m.status !== "pending");
  const canDraft = matchups.length >= 1 && !roundUnderway && !!homeTeam && !!awayTeam;

  // Copy targets: other rounds of the same side-size that aren't underway, so
  // Thursday's pairings can be applied to Thursday's second round in one tap.
  const sourceTeamSize = round.formats?.team_size ?? null;
  const { data: otherRoundsRaw } = await supabase
    .from("rounds")
    .select("id, round_number, name, formats(team_size)")
    .eq("event_id", params.id)
    .neq("id", params.roundId)
    .order("round_number");
  const otherRounds = (otherRoundsRaw ?? []) as unknown as {
    id: string; round_number: number; name: string | null; formats: { team_size: number | null } | null;
  }[];
  const otherIds = otherRounds.map((r) => r.id);
  const { data: otherMatchupStatuses } = otherIds.length > 0
    ? await supabase.from("matchups").select("round_id, status").in("round_id", otherIds)
    : { data: [] as { round_id: string; status: string }[] };
  const underwayRoundIds = new Set(
    (otherMatchupStatuses ?? []).filter((m) => m.status !== "pending").map((m) => m.round_id),
  );
  const copyTargets = otherRounds.filter(
    (r) => (r.formats?.team_size ?? null) === sourceTeamSize && !underwayRoundIds.has(r.id),
  );

  // ── Server actions ──────────────────────────────────────────

  async function addMatchup(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { data: existing } = await supabase
      .from("matchups")
      .select("match_number")
      .eq("round_id", params.roundId)
      .order("match_number", { ascending: false })
      .limit(1);
    const nextNum = ((existing?.[0]?.match_number) ?? 0) + 1;
    const teeTime = formData.get("tee_time") as string;

    const { error } = await supabase.from("matchups").insert({
      round_id:     params.roundId,
      match_number: nextNum,
      home_p1_id:   formData.get("home_p1") as string || null,
      home_p2_id:   isSingles ? null : (formData.get("home_p2") as string || null),
      away_p1_id:   formData.get("away_p1") as string || null,
      away_p2_id:   isSingles ? null : (formData.get("away_p2") as string || null),
      tee_time:     teeTime || null,
    });
    failTo(`/admin/events/${params.id}/rounds/${params.roundId}/matchups`, error);
    revalidatePath(`/admin/events/${params.id}/rounds/${params.roundId}/matchups`);
  }

  async function saveTeeTime(formData: FormData) {
    "use server";
    const supabase = createClient();
    const teeTime = formData.get("tee_time") as string;
    const { error } = await supabase
      .from("matchups")
      .update({ tee_time: teeTime || null })
      .eq("id", formData.get("matchup_id") as string);
    failTo(`/admin/events/${params.id}/rounds/${params.roundId}/matchups`, error);
    revalidatePath(`/admin/events/${params.id}/rounds/${params.roundId}/matchups`);
  }

  async function deleteMatchup(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("matchups").delete().eq("id", formData.get("matchup_id") as string);
    failTo(`/admin/events/${params.id}/rounds/${params.roundId}/matchups`, error);
    revalidatePath(`/admin/events/${params.id}/rounds/${params.roundId}/matchups`);
  }

  // Apply this round's pairings to another round (e.g. Thursday AM → PM).
  // Maps by match_number: updates a matching slot, or creates it if missing.
  async function copyPairings(formData: FormData) {
    "use server";
    const me = await requirePlayer();
    if (!isAdmin(me)) redirect("/");
    const supabase = createClient();
    const path = `/admin/events/${params.id}/rounds/${params.roundId}/matchups`;
    const targetId = formData.get("target_round_id") as string;
    if (!targetId) { failTo(path, { message: "Pick a round to copy into." }); return; }

    const { data: src } = await supabase
      .from("matchups")
      .select("match_number, home_p1_id, home_p2_id, away_p1_id, away_p2_id")
      .eq("round_id", params.roundId).order("match_number");
    if (!src || src.length === 0) { failTo(path, { message: "No pairings here to copy." }); return; }

    const { data: tgt } = await supabase
      .from("matchups").select("id, match_number, status").eq("round_id", targetId);
    if ((tgt ?? []).some((m) => m.status !== "pending")) {
      failTo(path, { message: "That round is underway — can't overwrite its lineups." });
      return;
    }
    const tgtByNum = new Map((tgt ?? []).map((m) => [m.match_number, m]));

    for (const m of src) {
      const sides = {
        home_p1_id: m.home_p1_id, home_p2_id: m.home_p2_id,
        away_p1_id: m.away_p1_id, away_p2_id: m.away_p2_id,
      };
      const existing = tgtByNum.get(m.match_number);
      const { error } = existing
        ? await supabase.from("matchups").update(sides).eq("id", existing.id)
        : await supabase.from("matchups").insert({ round_id: targetId, match_number: m.match_number, ...sides });
      failTo(path, error);
    }

    // If the target's lineups are now fully set, complete any open draft on it
    // so it doesn't sit stuck on LIVE (the copy set the pairings, not picks).
    const { data: tgtAfter } = await supabase
      .from("matchups").select("home_p1_id, away_p1_id").eq("round_id", targetId);
    const allSet = (tgtAfter?.length ?? 0) > 0 && (tgtAfter ?? []).every((m) => m.home_p1_id && m.away_p1_id);
    if (allSet) {
      await supabase.from("lineup_drafts")
        .update({ status: "complete", current_pick_started_at: null })
        .eq("round_id", targetId).neq("status", "complete");
    }

    const { data: tRound } = await supabase.from("rounds").select("round_number").eq("id", targetId).single();
    revalidatePath(path);
    revalidatePath(`/admin/events/${params.id}/rounds/${targetId}/matchups`);
    revalidatePath(`/matches/lineup-draft/${targetId}`);
    revalidatePath("/matches");
    redirect(`${path}?copied=${tRound?.round_number ?? ""}`);
  }

  async function startLineupDraftAction(formData: FormData) {
    "use server";
    const { error } = await startLineupDraft(params.roundId, (formData.get("first_pick") as string) || undefined);
    failTo(`/admin/events/${params.id}/rounds/${params.roundId}/matchups`, error ? { message: error } : null);
    redirect(`/matches/lineup-draft/${params.roundId}`);
  }

  async function resetLineupDraft(formData: FormData) {
    "use server";
    const supabase = createClient();
    const path = `/admin/events/${params.id}/rounds/${params.roundId}/matchups`;
    const id = formData.get("draft_id") as string;
    await supabase.from("lineup_draft_picks").delete().eq("draft_id", id);
    const { error: clearErr } = await supabase.from("matchups").update({
      home_p1_id: null, home_p2_id: null, away_p1_id: null, away_p2_id: null,
    }).eq("round_id", params.roundId);
    failTo(path, clearErr);
    const { error } = await supabase.from("lineup_drafts")
      .update({ status: "scheduled", current_pick_started_at: null }).eq("id", id);
    failTo(path, error);
    revalidatePath(path);
    revalidatePath(`/matches/lineup-draft/${params.roundId}`);
    revalidatePath("/matches");
  }

  async function deleteLineupDraft(formData: FormData) {
    "use server";
    const supabase = createClient();
    const path = `/admin/events/${params.id}/rounds/${params.roundId}/matchups`;
    // Leaves whatever lineups are set on the matchups; only drops the draft.
    const { error } = await supabase.from("lineup_drafts").delete().eq("id", formData.get("draft_id") as string);
    failTo(path, error);
    revalidatePath(path);
    revalidatePath("/matches");
  }

  // Finish a draft without running every pick — e.g. lineups were set by
  // copying another round. Clears the LIVE state, keeps the matchups.
  async function completeLineupDraft(formData: FormData) {
    "use server";
    const supabase = createClient();
    const path = `/admin/events/${params.id}/rounds/${params.roundId}/matchups`;
    const { error } = await supabase.from("lineup_drafts")
      .update({ status: "complete", current_pick_started_at: null })
      .eq("id", formData.get("draft_id") as string);
    failTo(path, error);
    revalidatePath(path);
    revalidatePath("/matches");
    revalidatePath(`/matches/lineup-draft/${params.roundId}`);
  }

  function resultDisplay(result: string | null, matchScore: string | null) {
    if (!result) return null;
    const homeName = homeTeam?.name ?? "Home";
    const awayName = awayTeam?.name ?? "Away";
    const label =
      result === "home"  ? `${homeName} wins` :
      result === "away"  ? `${awayName} wins` :
      "Halved";
    const points =
      result === "home"  ? `${homeName} 1 – 0 ${awayName}` :
      result === "away"  ? `${homeName} 0 – 1 ${awayName}` :
      `${homeName} ½ – ½ ${awayName}`;
    return { label, points, score: matchScore };
  }

  function fmt12(t: string | null) {
    if (!t) return null;
    const [hStr, mStr] = t.split(":");
    const h = parseInt(hStr);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${mStr} ${ampm}`;
  }

  // Tee times come first, lineups later (draft or pickers) — so only require
  // that the event has two teams, not that unpaired players exist yet.
  const canAdd = !!homeTeam && !!awayTeam;

  return (
    <div className="px-4 py-6 space-y-6">
      <Link href={`/admin/events/${params.id}`} className="text-sm text-navy/50 hover:text-navy">
        ← {round.name ?? `Round ${round.round_number}`}
      </Link>
      <ErrorBanner message={searchParams.error} />
      {searchParams.copied && (
        <p className="rounded-lg bg-europe-green/10 px-3 py-2 text-sm font-semibold text-europe-green">
          ✓ Pairings copied to Round {searchParams.copied}.
        </p>
      )}

      <div>
        <h1 className="text-2xl font-display font-bold text-navy">
          Tee Times — Round {round.round_number}
          {round.name ? ` · ${round.name}` : ""}
        </h1>
        <p className="text-sm text-navy/50 mt-0.5">
          {round.course_tees?.courses?.name} · {round.course_tees?.tee_name} Tees ·{" "}
          {sideLabel[round.side]} · {round.formats?.name}
        </p>
      </div>

      {/* Copy pairings to another round (same side-size, not underway) */}
      {matchups.length > 0 && copyTargets.length > 0 && (
        <ConfirmForm
          action={copyPairings}
          confirm="Copy these pairings into the selected round? It overwrites that round's current lineups."
          className="flex items-center gap-2 rounded-xl border border-hairline bg-white p-4"
        >
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-navy text-sm">Copy pairings to…</p>
            <p className="text-xs text-navy/50">Apply this round&rsquo;s lineups to another round (e.g. Thursday AM → PM).</p>
            <select name="target_round_id" required defaultValue=""
              className="mt-2 w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
              <option value="" disabled>Choose a round…</option>
              {copyTargets.map((r) => (
                <option key={r.id} value={r.id}>
                  Round {r.round_number}{r.name ? ` · ${r.name}` : ""}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="shrink-0 self-end rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-off-white">
            Copy
          </button>
        </ConfirmForm>
      )}

      {/* Lineup Draft */}
      <div className="rounded-xl border border-hairline bg-parchment p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-navy text-sm">Lineup Draft</p>
          {lineupDraft && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
              lineupDraft.status === "live" ? "bg-gold text-navy"
              : lineupDraft.status === "complete" ? "bg-europe-green text-white"
              : "bg-navy/10 text-navy/60"
            }`}>
              {lineupDraft.status}
            </span>
          )}
        </div>
        <p className="text-xs text-navy/50">
          Draft this round&rsquo;s matchups snake-style, with a big reveal to cast on the TV.
          Optional — the pickers below still work for a quiet night.
        </p>

        {!lineupDraft || lineupDraft.status === "scheduled" ? (
          canDraft ? (
            <form action={startLineupDraftAction} className="space-y-2">
              <p className="text-xs text-navy/50">Who picks first?</p>
              <div className="flex gap-2">
                {[homeTeam, awayTeam].map((t, i) => (
                  <label key={t!.id} className="flex-1 cursor-pointer">
                    <input type="radio" name="first_pick" value={t!.id} defaultChecked={i === 0} className="peer sr-only" />
                    <span className="flex items-center justify-center gap-1.5 rounded-lg border border-hairline bg-white px-3 py-2 text-center text-sm font-semibold text-navy peer-checked:border-navy peer-checked:bg-navy peer-checked:text-off-white">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: t!.color }} />
                      {t!.name}
                    </span>
                  </label>
                ))}
              </div>
              <button type="submit" className="w-full rounded-lg bg-europe-green py-2 text-sm font-bold text-white">
                🐉 Start Lineup Draft
              </button>
            </form>
          ) : (
            <p className="rounded-lg bg-gold/15 px-3 py-2 text-xs text-navy/70">
              {roundUnderway
                ? "This round is underway — lineups are locked."
                : !homeTeam || !awayTeam
                ? "The event needs two teams first."
                : "Add tee times below before drafting."}
            </p>
          )
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Link href={`/matches/lineup-draft/${params.roundId}`}
                className="flex-1 rounded-lg bg-navy py-2 text-center text-sm font-semibold text-off-white">
                Open Draft Room
              </Link>
              <DeleteButton
                action={resetLineupDraft}
                fields={{ draft_id: lineupDraft.id }}
                confirm="Reset the lineup draft? All picks clear and the matchups blank out."
                label="Reset"
                className="rounded-lg border border-usa-red/40 px-3 py-2 text-sm font-semibold text-usa-red"
              />
            </div>
            {lineupDraft.status === "live" && (
              <form action={completeLineupDraft}>
                <input type="hidden" name="draft_id" value={lineupDraft.id} />
                <button type="submit"
                  className="w-full rounded-lg bg-europe-green py-2 text-sm font-bold text-white">
                  ✓ Mark draft complete
                </button>
                <p className="mt-1 text-center text-[11px] text-navy/45">
                  Ends the LIVE draft and keeps the current pairings (use this if you set lineups by copying another round).
                </p>
              </form>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs text-navy/50">{lineupPickCount ?? 0} of {matchups.length * 2} picks in</span>
              <DeleteButton
                action={deleteLineupDraft}
                fields={{ draft_id: lineupDraft.id }}
                confirm="Delete this lineup draft? The matchups keep whatever's set."
                label="Delete draft"
                className="text-xs text-usa-red hover:underline"
              />
            </div>
          </div>
        )}
      </div>

      {/* Matchup list */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-navy/60 uppercase tracking-wide">
          {matchups.length} Tee Time{matchups.length !== 1 ? "s" : ""}
        </p>
        {matchups.length === 0 && <p className="text-sm text-navy/40">No tee times yet.</p>}

        {matchups.map((m) => {
          const homePairing = isSingles
            ? (m.home_p1?.display_name ?? "—")
            : [m.home_p1?.display_name, m.home_p2?.display_name].filter(Boolean).join(" / ") || "—";
          const awayPairing = isSingles
            ? (m.away_p1?.display_name ?? "—")
            : [m.away_p1?.display_name, m.away_p2?.display_name].filter(Boolean).join(" / ") || "—";

          return (
            <div key={m.id} className="rounded-xl border border-hairline bg-white px-4 py-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-navy/40 font-semibold uppercase tracking-wide mb-1">
                    Match {m.match_number}
                    {m.formats && m.formats.name !== round.formats?.name && (
                      <span className="ml-2 rounded-full border border-gold/60 bg-gold/10 px-2 py-0.5 font-semibold normal-case text-navy/80">
                        {m.formats.name}
                      </span>
                    )}
                    {m.tee_time && (
                      <span className="ml-2 font-normal normal-case text-navy/50">
                        · {fmt12(m.tee_time)}
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <span className="font-semibold text-navy">{homePairing}</span>
                    <span className="text-navy/30">vs</span>
                    <span className="font-semibold text-navy">{awayPairing}</span>
                  </div>
                  {(() => {
                    const r = resultDisplay(m.result, m.match_score);
                    if (!r) return null;
                    return (
                      <div className="mt-1 space-y-0.5">
                        <p className="text-xs font-semibold text-navy/70">{r.label}{r.score ? ` · ${r.score}` : ""}</p>
                        <p className="text-xs text-navy/40">{r.points}</p>
                      </div>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    m.status === "complete" ? "bg-green-100 text-green-700"
                    : m.status === "active"  ? "bg-amber-100 text-amber-700"
                    : "bg-navy/10 text-navy/50"
                  }`}>
                    {m.status}
                  </span>
                  <Link href={`/admin/events/${params.id}/rounds/${params.roundId}/matchups/${m.id}/scorecard`}
                    className="text-sm text-navy/60 hover:text-navy">
                    Scorecard ›
                  </Link>
                  <Link href={`/admin/events/${params.id}/rounds/${params.roundId}/matchups/${m.id}`}
                    className="text-sm text-navy/60 hover:text-navy">
                    Edit ›
                  </Link>
                  <DeleteButton
                    action={deleteMatchup}
                    fields={{ matchup_id: m.id }}
                    confirm={`Delete Match ${m.match_number}?`}
                    label="Delete"
                    className="text-xs text-usa-red hover:underline"
                  />
                </div>
              </div>

              {/* Inline tee time edit */}
              <form action={saveTeeTime} className="flex items-center gap-2 border-t border-hairline pt-2">
                <input type="hidden" name="matchup_id" value={m.id} />
                <label className="text-xs text-navy/50 w-16 flex-shrink-0">Tee time</label>
                <input
                  name="tee_time"
                  type="time"
                  defaultValue={m.tee_time ?? ""}
                  className="flex-1 rounded border border-hairline px-2 py-1 text-sm text-navy"
                />
                <button type="submit" className="text-xs text-navy/50 hover:text-navy underline flex-shrink-0">
                  Save
                </button>
              </form>
            </div>
          );
        })}
      </div>

      {/* Add matchup form */}
      {canAdd ? (
        <form action={addMatchup} className="rounded-xl border border-dashed border-hairline p-4 space-y-4">
          <p className="font-semibold text-navy text-sm">Add Tee Time</p>

          {/* Tee time */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-navy/60 w-20 flex-shrink-0">Tee time</label>
            <input
              name="tee_time"
              type="time"
              className="flex-1 rounded-lg border border-hairline px-3 py-2 text-sm text-navy"
            />
          </div>

          {/* Home team */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-navy/60 uppercase tracking-wide flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: homeTeam?.color ?? "#ccc" }} />
              {homeTeam?.name ?? "Home"}
            </p>
            <select name="home_p1"
              className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
              <option value="">Player (optional — captains can fill in)</option>
              {availableHome.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </select>
            {!isSingles && (
              <select name="home_p2"
                className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
                <option value="">Partner (optional for 2v1)</option>
                {availableHome.map((p) => (
                  <option key={p.id} value={p.id}>{p.display_name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Away team */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-navy/60 uppercase tracking-wide flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: awayTeam?.color ?? "#ccc" }} />
              {awayTeam?.name ?? "Away"}
            </p>
            <select name="away_p1"
              className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
              <option value="">Player (optional — captains can fill in)</option>
              {availableAway.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </select>
            {!isSingles && (
              <select name="away_p2"
                className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
                <option value="">Partner (optional for 2v1)</option>
                {availableAway.map((p) => (
                  <option key={p.id} value={p.id}>{p.display_name}</option>
                ))}
              </select>
            )}
          </div>

          <button type="submit"
            className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
            Add Tee Time
          </button>
        </form>
      ) : (
        <p className="text-sm text-navy/40">Add two teams to this event before creating tee times.</p>
      )}
    </div>
  );
}
