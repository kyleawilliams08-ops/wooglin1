"use server";

import { requirePlayer, isAdmin, type Player } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { teamIndexForPick, roundForPick } from "@/lib/draft";
import { recordLineupDraftEvent } from "@/lib/feed";

type Supa = ReturnType<typeof createClient>;

interface LineupDraftRow {
  id: string;
  round_id: string;
  status: "scheduled" | "live" | "complete";
  first_pick_team_id: string | null;
}
interface Team { id: string; name: string; color: string }
interface MatchupRow {
  id: string; match_number: number;
  home_p1_id: string | null; home_p2_id: string | null;
  away_p1_id: string | null; away_p2_id: string | null;
  status: string;
}

/**
 * The draft's live state: teams in snake order ([first-pick, other]), the
 * round's matchups (match_number order), event id, side size, and the pick
 * count. Returns an error string for anything unusable — errors are returned,
 * not thrown, since thrown server-action errors are masked in production.
 */
async function loadState(supabase: Supa, draftId: string) {
  const { data: draft } = await supabase
    .from("lineup_drafts").select("*").eq("id", draftId).single<LineupDraftRow>();
  if (!draft) return { error: "Draft not found.", state: null };

  const { data: round } = await supabase
    .from("rounds").select("id, event_id, round_number, formats(team_size)")
    .eq("id", draft.round_id).single();
  if (!round) return { error: "Round not found.", state: null };
  const sideSize = ((round.formats as unknown as { team_size: number | null } | null)?.team_size) ?? 1;

  const { data: teams } = await supabase
    .from("teams").select("id, name, color").eq("event_id", round.event_id).order("name");
  if (!teams || teams.length !== 2) return { error: "The event needs exactly two teams.", state: null };
  const first = teams.find((t) => t.id === draft.first_pick_team_id) ?? teams[0];
  const other = teams.find((t) => t.id !== first.id)!;
  const ordered: [Team, Team] = [first, other];
  const homeTeamId = teams[0].id; // home = first team alphabetically

  const { data: matchups } = await supabase
    .from("matchups")
    .select("id, match_number, home_p1_id, home_p2_id, away_p1_id, away_p2_id, status")
    .eq("round_id", draft.round_id)
    .order("match_number");
  const rows = (matchups ?? []) as MatchupRow[];

  const { count } = await supabase
    .from("lineup_draft_picks").select("*", { count: "exact", head: true }).eq("draft_id", draftId);

  return {
    error: null,
    state: {
      draft, ordered, homeTeamId, sideSize,
      eventId: round.event_id as string, roundNumber: round.round_number as number,
      matchups: rows, pickCount: count ?? 0,
    },
  };
}

/** True if this player captains `teamId` in `eventId`. */
async function isCaptainOf(supabase: Supa, player: Player, eventId: string, teamId: string) {
  const { data } = await supabase
    .from("event_participants").select("id")
    .eq("event_id", eventId).eq("player_id", player.id)
    .eq("team_id", teamId).eq("is_captain", true).limit(1);
  return (data?.length ?? 0) > 0;
}

/**
 * Make the on-the-clock team's pick — 1 player (Singles) or a pairing.
 * Caller must be an admin (commissioner can pick on behalf) or the captain
 * of the team on the clock. Writes the picks-log row (unique pick_number
 * settles double-tap races) and the matchup's side, then advances the clock
 * or completes the draft.
 */
export async function makeLineupPick(
  draftId: string,
  participantIds: string[],
): Promise<{ error: string | null }> {
  const player = await requirePlayer();
  const supabase = createClient();

  const { error: stateError, state } = await loadState(supabase, draftId);
  if (stateError || !state) return { error: stateError };
  const { draft, ordered, homeTeamId, sideSize, eventId, roundNumber, matchups, pickCount } = state;

  if (draft.status !== "live") return { error: "The lineup draft isn't live." };

  const totalPicks = matchups.length * 2;
  const nextPick = pickCount + 1;
  if (nextPick > totalPicks) return { error: "Every match is already set." };

  const matchup = matchups[roundForPick(nextPick) - 1];
  const onClock = ordered[teamIndexForPick(nextPick)];
  if (!isAdmin(player) && !(await isCaptainOf(supabase, player, eventId, onClock.id))) {
    return { error: `It's ${onClock.name}'s pick.` };
  }

  const ids = participantIds.filter(Boolean);
  if (ids.length < 1 || ids.length > sideSize) {
    return { error: sideSize === 1 ? "Pick one player." : "Pick one or two players." };
  }
  if (new Set(ids).size !== ids.length) return { error: "That's the same player twice." };

  // All picks must be on the on-clock team's roster and unused this round.
  const { data: roster } = await supabase
    .from("event_participants").select("id, display_name")
    .eq("event_id", eventId).eq("team_id", onClock.id);
  const rosterIds = new Set((roster ?? []).map((r) => r.id));
  if (!ids.every((id) => rosterIds.has(id))) return { error: `Those players aren't on ${onClock.name}.` };

  const usedThisRound = new Set(
    matchups.flatMap((m) => [m.home_p1_id, m.home_p2_id, m.away_p1_id, m.away_p2_id].filter(Boolean) as string[]),
  );
  const clash = ids.find((id) => usedThisRound.has(id));
  if (clash) {
    const name = (roster ?? []).find((r) => r.id === clash)?.display_name ?? "That player";
    return { error: `${name} is already in a match this round.` };
  }

  const side: "home" | "away" = onClock.id === homeTeamId ? "home" : "away";

  const { error: pickError } = await supabase.from("lineup_draft_picks").insert({
    draft_id: draftId,
    pick_number: nextPick,
    team_id: onClock.id,
    matchup_id: matchup.id,
    side,
    p1_id: ids[0],
    p2_id: sideSize === 2 ? (ids[1] ?? null) : null,
    picked_by: player.id,
  });
  if (pickError) {
    return {
      error: pickError.code === "23505"
        ? "That pick just went through on another screen — check the board."
        : pickError.message,
    };
  }

  const { data: written, error: matchupError } = await supabase.from("matchups").update({
    [`${side}_p1_id`]: ids[0],
    [`${side}_p2_id`]: sideSize === 2 ? (ids[1] ?? null) : null,
  }).eq("id", matchup.id).select("id");
  if (matchupError || !written?.length) {
    // Roll the pick back so board and matchup can't disagree. A 0-row result
    // with no error means RLS blocked the write — surface it rather than
    // leaving a phantom pick.
    await supabase.from("lineup_draft_picks").delete().eq("draft_id", draftId).eq("pick_number", nextPick);
    return {
      error: matchupError?.message
        ?? "Couldn't set the pairing — a permissions issue blocked the write. Make sure the latest migrations.sql has been run.",
    };
  }

  const done = nextPick === totalPicks;
  await supabase.from("lineup_drafts").update(
    done
      ? { status: "complete", current_pick_started_at: null }
      : { current_pick_started_at: new Date().toISOString() },
  ).eq("id", draftId);

  // When both sides of this match are now filled, announce the clash.
  const otherSide = side === "home" ? "away" : "home";
  const otherFilled = matchup[`${otherSide}_p1_id` as keyof MatchupRow];
  if (otherFilled) {
    const { data: names } = await supabase
      .from("matchups")
      .select(`
        home_p1:event_participants!matchups_home_p1_id_fkey(display_name),
        home_p2:event_participants!matchups_home_p2_id_fkey(display_name),
        away_p1:event_participants!matchups_away_p1_id_fkey(display_name),
        away_p2:event_participants!matchups_away_p2_id_fkey(display_name)`)
      .eq("id", matchup.id).single();
    const label = (a?: { display_name: string } | null, b?: { display_name: string } | null) =>
      [a?.display_name, b?.display_name].filter(Boolean).join(" & ");
    const n = names as Record<string, { display_name: string } | null> | null;
    if (n) {
      const home = ordered.find((t) => t.id === homeTeamId)!;
      const away = ordered.find((t) => t.id !== homeTeamId)!;
      await recordLineupDraftEvent(supabase, eventId,
        `🥊 Match ${matchup.match_number} set: ${label(n.home_p1, n.home_p2)} (${home.name}) vs ${label(n.away_p1, n.away_p2)} (${away.name})`);
    }
  }
  if (done) {
    await recordLineupDraftEvent(supabase, eventId, `✅ Round ${roundNumber} lineups are set!`);
  }

  revalidatePath(`/matches/lineup-draft/${draft.round_id}`);
  revalidatePath("/matches");
  return { error: null };
}

/**
 * Admin-only: start (or restart) a round's lineup draft. Clears the round's
 * matchup sides to a blank slate, then flips the draft live. Shared by the
 * round's matchups admin page and the /matches board so the ceremony can be
 * kicked off from either. Returns an error; the caller handles navigation.
 */
export async function startLineupDraft(
  roundId: string,
  firstPickTeamId?: string,
): Promise<{ error: string | null }> {
  const player = await requirePlayer();
  if (!isAdmin(player)) return { error: "Only the commissioner can start the draft." };
  const supabase = createClient();

  const { data: round } = await supabase
    .from("rounds").select("id, event_id, round_number").eq("id", roundId).single();
  if (!round) return { error: "Round not found." };

  const { data: ms } = await supabase.from("matchups").select("id, status").eq("round_id", roundId);
  if (!ms || ms.length === 0) return { error: "Add matchups for this round first." };
  if (ms.some((m) => m.status !== "pending")) {
    return { error: "This round is underway — can't draft lineups now." };
  }

  const { error: clearErr } = await supabase.from("matchups").update({
    home_p1_id: null, home_p2_id: null, away_p1_id: null, away_p2_id: null,
  }).eq("round_id", roundId);
  if (clearErr) return { error: clearErr.message };

  const { data: teams } = await supabase.from("teams").select("id").eq("event_id", round.event_id).order("name");
  const defaultFirst = firstPickTeamId || teams?.[0]?.id || null;

  const { data: existing } = await supabase
    .from("lineup_drafts").select("id").eq("round_id", roundId).maybeSingle();
  if (existing) {
    await supabase.from("lineup_draft_picks").delete().eq("draft_id", existing.id);
    const { error } = await supabase.from("lineup_drafts").update({
      status: "live", first_pick_team_id: defaultFirst, current_pick_started_at: new Date().toISOString(),
    }).eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("lineup_drafts").insert({
      round_id: roundId, status: "live", first_pick_team_id: defaultFirst,
      current_pick_started_at: new Date().toISOString(),
    });
    if (error) return { error: error.message };
  }

  await recordLineupDraftEvent(supabase, round.event_id, `📋 Lineup draft is live — Round ${round.round_number}`);
  revalidatePath("/matches");
  revalidatePath(`/matches/lineup-draft/${roundId}`);
  revalidatePath(`/admin/events/${round.event_id}/rounds/${roundId}/matchups`);
  revalidatePath("/");
  return { error: null };
}

/** Admin-only: take back the most recent pick and clear that matchup side. */
export async function undoLastLineupPick(draftId: string): Promise<{ error: string | null }> {
  const player = await requirePlayer();
  if (!isAdmin(player)) return { error: "Only the commissioner can undo picks." };
  const supabase = createClient();

  const { data: draft } = await supabase
    .from("lineup_drafts").select("id, round_id").eq("id", draftId).single();
  if (!draft) return { error: "Draft not found." };

  const { data: picks } = await supabase
    .from("lineup_draft_picks")
    .select("id, pick_number, matchup_id, side")
    .eq("draft_id", draftId).order("pick_number", { ascending: false }).limit(1);
  const last = picks?.[0];
  if (!last) return { error: "No picks to undo." };

  const { error: clearError } = await supabase.from("matchups").update({
    [`${last.side}_p1_id`]: null,
    [`${last.side}_p2_id`]: null,
  }).eq("id", last.matchup_id);
  if (clearError) return { error: clearError.message };

  const { error: deleteError } = await supabase.from("lineup_draft_picks").delete().eq("id", last.id);
  if (deleteError) return { error: deleteError.message };

  const { error: draftError } = await supabase.from("lineup_drafts").update({
    status: "live",
    current_pick_started_at: new Date().toISOString(),
  }).eq("id", draftId);
  if (draftError) return { error: draftError.message };

  revalidatePath(`/matches/lineup-draft/${draft.round_id}`);
  revalidatePath("/matches");
  return { error: null };
}
