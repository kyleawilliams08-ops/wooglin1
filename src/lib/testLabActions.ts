"use server";

// Test Lab (admin-only): dress-rehearsal tooling.
//  - Test copy: deep-copies an event's SETUP (teams, field, rounds, tee times,
//    lineups, handicaps, CTP holes) into a new event flagged is_test. It stays
//    status 'draft', so it never becomes anyone's active event.
//  - Test mode: a cookie pointing this admin's browser at the test copy
//    (see lib/currentEvent). Everyone else keeps seeing the real cup.
//  - View as: a cookie making the app behave as another player (see lib/auth).
// Every action re-checks the REAL signed-in player, so they keep working (and
// can always be exited) while masquerading as a non-admin.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { requireRealPlayer, isAdmin, MASQ_COOKIE } from "@/lib/auth";
import { TEST_EVENT_COOKIE } from "@/lib/currentEvent";
import { failTo } from "@/lib/actionError";

const LAB = "/admin/test-lab";
// Auto-expire so a forgotten masquerade/test mode can't linger into the trip.
const COOKIE_OPTS = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 12 };

async function requireAdmin() {
  const real = await requireRealPlayer();
  if (!isAdmin(real)) redirect("/");
  return real;
}

type Row = Record<string, unknown>;
/** Drop identity columns so a row can be re-inserted as a copy. */
function strip(row: Row, ...extra: string[]): Row {
  const out = { ...row };
  for (const k of ["id", "created_at", ...extra]) delete out[k];
  return out;
}

// ── View as ────────────────────────────────────────────────────────────────

export async function startMasquerade(formData: FormData) {
  await requireAdmin();
  const playerId = formData.get("player_id") as string;
  if (!playerId) failTo(LAB, { message: "Pick a player to view as." });
  cookies().set(MASQ_COOKIE, playerId, COOKIE_OPTS);
  redirect("/");
}

export async function stopMasquerade() {
  await requireAdmin();
  cookies().delete(MASQ_COOKIE);
  redirect(LAB);
}

// ── Test mode ──────────────────────────────────────────────────────────────

export async function enterTestMode(formData: FormData) {
  await requireAdmin();
  const supabase = createClient();
  const eventId = formData.get("event_id") as string;
  const { data: ev, error } = await supabase
    .from("events").select("id").eq("id", eventId).eq("is_test", true).maybeSingle();
  failTo(LAB, error);
  if (!ev) failTo(LAB, { message: "That isn't a test event." });
  cookies().set(TEST_EVENT_COOKIE, eventId, COOKIE_OPTS);
  redirect("/");
}

export async function exitTestMode() {
  await requireAdmin();
  cookies().delete(TEST_EVENT_COOKIE);
  redirect(LAB);
}

// ── Test copy ──────────────────────────────────────────────────────────────

export async function createTestCopy(formData: FormData) {
  await requireAdmin();
  const supabase = createClient();
  const sourceId = formData.get("event_id") as string;

  const { data: src, error: srcErr } = await supabase
    .from("events").select("*").eq("id", sourceId).single();
  failTo(LAB, srcErr);
  if (!src) return;

  // New ids are generated here so every foreign key can be remapped up front.
  const newEventId = randomUUID();
  const { error: evErr } = await supabase.from("events").insert({
    ...strip(src as Row),
    id: newEventId,
    name: `${(src as { name: string }).name} (TEST)`,
    status: "draft",          // never 'active' — nobody can land on it
    is_test: true,
  });
  failTo(LAB, evErr && {
    message: `${evErr.message} — has the TEST LAB section of migrations.sql been run?`,
  });

  // From here on, any failure deletes the half-built copy (cascades).
  const bail = async (step: string, error: { message: string } | null) => {
    if (!error) return;
    await supabase.from("events").delete().eq("id", newEventId);
    failTo(LAB, { message: `Test copy failed at ${step}: ${error.message}` });
  };
  const remap = (map: Map<string, string>, id: unknown) =>
    typeof id === "string" ? map.get(id) ?? null : null;

  // Teams
  const { data: teams, error: tErr } = await supabase.from("teams").select("*").eq("event_id", sourceId);
  await bail("reading teams", tErr);
  const teamMap = new Map((teams ?? []).map((t) => [t.id as string, randomUUID()]));
  if (teams?.length) {
    const { error } = await supabase.from("teams").insert(
      teams.map((t) => ({ ...strip(t), id: teamMap.get(t.id)!, event_id: newEventId })));
    await bail("teams", error);
  }

  // Field (participants keep their player link, captaincy and team)
  const { data: parts, error: pErr } = await supabase.from("event_participants").select("*").eq("event_id", sourceId);
  await bail("reading participants", pErr);
  const partMap = new Map((parts ?? []).map((p) => [p.id as string, randomUUID()]));
  if (parts?.length) {
    const { error } = await supabase.from("event_participants").insert(
      parts.map((p) => ({
        ...strip(p), id: partMap.get(p.id)!, event_id: newEventId,
        team_id: remap(teamMap, p.team_id),
      })));
    await bail("participants", error);
  }

  // Courses + handicaps
  const { data: ecs, error: ecErr } = await supabase.from("event_courses").select("*").eq("event_id", sourceId);
  await bail("reading courses", ecErr);
  if (ecs?.length) {
    const { error } = await supabase.from("event_courses").insert(
      ecs.map((c) => ({ ...strip(c), event_id: newEventId })));
    await bail("courses", error);
  }
  const { data: hcps, error: hErr } = await supabase.from("participant_handicaps").select("*").eq("event_id", sourceId);
  await bail("reading handicaps", hErr);
  if (hcps?.length) {
    const { error } = await supabase.from("participant_handicaps").insert(
      hcps.map((h) => ({ ...strip(h), event_id: newEventId })));
    await bail("handicaps", error);
  }

  // Rounds
  const { data: rounds, error: rErr } = await supabase.from("rounds").select("*").eq("event_id", sourceId);
  await bail("reading rounds", rErr);
  const roundMap = new Map((rounds ?? []).map((r) => [r.id as string, randomUUID()]));
  if (rounds?.length) {
    const { error } = await supabase.from("rounds").insert(
      rounds.map((r) => ({ ...strip(r), id: roundMap.get(r.id)!, event_id: newEventId, status: "pending" })));
    await bail("rounds", error);
  }

  const roundIds = Array.from(roundMap.keys());
  if (roundIds.length) {
    // Tee times + lineups — but a clean slate for results (no scores copied)
    const { data: matchups, error: mErr } = await supabase.from("matchups").select("*").in("round_id", roundIds);
    await bail("reading tee times", mErr);
    if (matchups?.length) {
      const { error } = await supabase.from("matchups").insert(
        matchups.map((m) => ({
          ...strip(m),
          round_id: roundMap.get(m.round_id)!,
          home_p1_id: remap(partMap, m.home_p1_id), home_p2_id: remap(partMap, m.home_p2_id),
          away_p1_id: remap(partMap, m.away_p1_id), away_p2_id: remap(partMap, m.away_p2_id),
          status: "pending", result: null, match_score: null,
        })));
      await bail("tee times", error);
    }

    // CTP holes (and stakes) — nobody holding, nothing posted to the ledger
    const { data: ctps, error: cErr } = await supabase.from("ctp_holes").select("*").in("round_id", roundIds);
    await bail("reading CTP holes", cErr);
    if (ctps?.length) {
      const { error } = await supabase.from("ctp_holes").insert(
        ctps.map((c) => ({
          ...strip(c), round_id: roundMap.get(c.round_id)!,
          holder_participant_id: null, holder_set_at: null, holder_set_by: null, bet_id: null,
        })));
      await bail("CTP holes", error);
    }
  }

  cookies().set(TEST_EVENT_COOKIE, newEventId, COOKIE_OPTS); // drop straight into it
  revalidatePath(LAB);
  redirect(`${LAB}?saved=1`);
}

export async function deleteTestEvent(formData: FormData) {
  await requireAdmin();
  const supabase = createClient();
  const eventId = formData.get("event_id") as string;
  // is_test in the WHERE clause: this can never delete a real event.
  const { error } = await supabase.from("events").delete().eq("id", eventId).eq("is_test", true);
  failTo(LAB, error);
  if (cookies().get(TEST_EVENT_COOKIE)?.value === eventId) cookies().delete(TEST_EVENT_COOKIE);
  revalidatePath(LAB);
  revalidatePath("/admin/events");
  redirect(`${LAB}?saved=1`);
}
