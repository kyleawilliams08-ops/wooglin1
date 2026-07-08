"use server";

import { requirePlayer, isAdmin, type Player } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { teamIndexForPick, pickLabel } from "@/lib/draft";
import { recordDraftEvent } from "@/lib/feed";

type Supa = ReturnType<typeof createClient>;

interface DraftRow {
  id: string;
  event_id: string;
  status: "scheduled" | "live" | "complete";
  first_pick_team_id: string | null;
  pick_seconds: number;
}

interface Team { id: string; name: string; color: string }

/**
 * Draft state the actions need: teams in snake order ([first-pick, other]),
 * current pick count, and the on-clock team. Returns an error string for
 * anything unusable. Errors are returned, not thrown — thrown server-action
 * errors are masked in production.
 */
async function loadDraftState(supabase: Supa, draftId: string) {
  const { data: draft } = await supabase
    .from("drafts").select("*").eq("id", draftId).single<DraftRow>();
  if (!draft) return { error: "Draft not found." as string, state: null };

  const { data: teams } = await supabase
    .from("teams").select("id, name, color").eq("event_id", draft.event_id)
    .order("name");
  if (!teams || teams.length !== 2) {
    return { error: "The event needs exactly two teams to draft.", state: null };
  }
  const first = teams.find((t) => t.id === draft.first_pick_team_id) ?? teams[0];
  const other = teams.find((t) => t.id !== first.id)!;
  const ordered: [Team, Team] = [first, other];

  const { count: pickCount } = await supabase
    .from("draft_picks").select("*", { count: "exact", head: true })
    .eq("draft_id", draftId);

  const nextPick = (pickCount ?? 0) + 1;
  const onClock = ordered[teamIndexForPick(nextPick)];
  return { error: null, state: { draft, ordered, nextPick, onClock } };
}

/** True if this player is the captain of `teamId` in `eventId`. */
async function isCaptainOf(supabase: Supa, player: Player, eventId: string, teamId: string) {
  const { data } = await supabase
    .from("event_participants").select("id")
    .eq("event_id", eventId).eq("player_id", player.id)
    .eq("team_id", teamId).eq("is_captain", true)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/**
 * Draft one player. Caller must be an admin (commissioner can pick on
 * behalf — half the room shares a phone on draft night) or the captain of
 * the team on the clock. The unique (draft_id, pick_number) constraint
 * settles double-tap races: the second write fails and surfaces here.
 */
export async function makePick(
  draftId: string,
  participantId: string,
): Promise<{ error: string | null }> {
  const player = await requirePlayer();
  const supabase = createClient();

  const { error: stateError, state } = await loadDraftState(supabase, draftId);
  if (stateError || !state) return { error: stateError };
  const { draft, nextPick, onClock } = state;

  if (draft.status !== "live") return { error: "The draft isn't live." };
  if (!isAdmin(player) && !(await isCaptainOf(supabase, player, draft.event_id, onClock.id))) {
    return { error: `It's ${onClock.name}'s pick.` };
  }

  const { data: part } = await supabase
    .from("event_participants")
    .select("id, event_id, team_id, is_captain, display_name")
    .eq("id", participantId).single();
  if (!part || part.event_id !== draft.event_id) return { error: "That player isn't in this event." };
  if (part.is_captain || part.team_id) return { error: `${part.display_name} is already on a team.` };

  const { error: pickError } = await supabase.from("draft_picks").insert({
    draft_id: draftId,
    pick_number: nextPick,
    team_id: onClock.id,
    participant_id: participantId,
    picked_by: player.id,
  });
  if (pickError) {
    return {
      error: pickError.code === "23505"
        ? "That pick just went through on another screen — refresh and check the board."
        : pickError.message,
    };
  }

  const { data: assigned, error: assignError } = await supabase
    .from("event_participants").update({ team_id: onClock.id }).eq("id", participantId).select("id");
  if (assignError || !assigned?.length) {
    // Roll the pick back so the board and the roster can't disagree. A 0-row
    // result with no error means RLS blocked the write (e.g. a captain before
    // the update policy has run) — surface it instead of leaving a phantom
    // pick with the player still in the pool.
    await supabase.from("draft_picks").delete()
      .eq("draft_id", draftId).eq("pick_number", nextPick);
    return {
      error: assignError?.message
        ?? "Couldn't assign the player — a permissions issue blocked the write. Make sure the latest migrations.sql has been run.",
    };
  }

  // Anyone left in the pool? If not, the rosters are set.
  const { count: remaining } = await supabase
    .from("event_participants").select("*", { count: "exact", head: true })
    .eq("event_id", draft.event_id).eq("is_captain", false).is("team_id", null);
  const done = (remaining ?? 0) === 0;

  const { error: draftError } = await supabase.from("drafts").update(
    done
      ? { status: "complete", current_pick_started_at: null }
      : { current_pick_started_at: new Date().toISOString() },
  ).eq("id", draftId);
  if (draftError) return { error: draftError.message };

  await recordDraftEvent(supabase, draft.event_id,
    `📋 ${pickLabel(nextPick)}: ${part.display_name} → ${onClock.name}`);
  if (done) {
    await recordDraftEvent(supabase, draft.event_id,
      "✅ The draft is complete — rosters are set!");
  }

  revalidatePath("/draft");
  revalidatePath("/");
  return { error: null };
}

/**
 * Admin-only: flip a scheduled draft to live (a convenience so the
 * commissioner can start straight from the draft room, not only the event
 * setup page). Requires at least one undrafted player in the pool.
 */
export async function startPlayerDraft(draftId: string): Promise<{ error: string | null }> {
  const player = await requirePlayer();
  if (!isAdmin(player)) return { error: "Only the commissioner can start the draft." };
  const supabase = createClient();

  const { data: draft } = await supabase
    .from("drafts").select("id, event_id, status, events(year)").eq("id", draftId).single();
  if (!draft) return { error: "Draft not found." };
  if (draft.status !== "scheduled") return { error: "The draft has already started." };

  const { count: poolCount } = await supabase
    .from("event_participants").select("*", { count: "exact", head: true })
    .eq("event_id", draft.event_id).eq("is_captain", false).is("team_id", null);
  if ((poolCount ?? 0) === 0) return { error: "Add players to the draft pool before starting." };

  const { error } = await supabase.from("drafts").update({
    status: "live",
    current_pick_started_at: new Date().toISOString(),
  }).eq("id", draftId);
  if (error) return { error: error.message };

  const year = (draft.events as unknown as { year: number } | null)?.year;
  await recordDraftEvent(supabase, draft.event_id, `🐉 The${year ? ` ${year}` : ""} draft is LIVE — watch the picks!`);
  revalidatePath("/draft");
  revalidatePath("/");
  return { error: null };
}

/** Admin-only: take back the most recent pick (fat fingers happen). */
export async function undoLastPick(draftId: string): Promise<{ error: string | null }> {
  const player = await requirePlayer();
  if (!isAdmin(player)) return { error: "Only the commissioner can undo picks." };
  const supabase = createClient();

  const { data: draft } = await supabase
    .from("drafts").select("id, event_id, status").eq("id", draftId).single();
  if (!draft) return { error: "Draft not found." };

  const { data: lastPicks } = await supabase
    .from("draft_picks")
    .select("id, pick_number, participant_id, event_participants(display_name)")
    .eq("draft_id", draftId)
    .order("pick_number", { ascending: false })
    .limit(1);
  const last = lastPicks?.[0];
  if (!last) return { error: "No picks to undo." };

  const { error: unassignError } = await supabase
    .from("event_participants").update({ team_id: null }).eq("id", last.participant_id);
  if (unassignError) return { error: unassignError.message };

  const { error: deleteError } = await supabase
    .from("draft_picks").delete().eq("id", last.id);
  if (deleteError) return { error: deleteError.message };

  const { error: draftError } = await supabase.from("drafts").update({
    status: "live",
    current_pick_started_at: new Date().toISOString(),
  }).eq("id", draftId);
  if (draftError) return { error: draftError.message };

  const name = (last.event_participants as unknown as { display_name: string } | null)?.display_name ?? "the last pick";
  await recordDraftEvent(supabase, draft.event_id,
    `↩️ The commissioner took back pick ${last.pick_number} (${name}) — redo!`);

  revalidatePath("/draft");
  revalidatePath("/");
  return { error: null };
}
