import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { DeleteButton } from "@/components/DeleteButton";
import { Collapsible } from "@/components/Collapsible";
import { EventTeamList } from "./EventTeamList";
import { ErrorBanner } from "@/components/ErrorBanner";
import { failTo } from "@/lib/actionError";
import { recordDraftEvent } from "@/lib/feed";
import { LocalDateTimeInput } from "@/components/LocalDateTimeInput";

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string; section?: string };
}) {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const supabase = createClient();

  const { data: event } = await supabase.from("events").select("*").eq("id", params.id).single();
  if (!event) redirect("/admin/events");

  const { data: teams } = await supabase
    .from("teams")
    .select("*")
    .eq("event_id", params.id);

  const { data: eventCoursesRaw } = await supabase
    .from("event_courses")
    .select("id, course_id, courses(id, name, location)")
    .eq("event_id", params.id);
  const eventCourses = (eventCoursesRaw ?? []) as unknown as {
    id: string;
    course_id: string;
    courses: { id: string; name: string; location: string | null } | null;
  }[];

  const { data: allCourses } = await supabase
    .from("courses")
    .select("id, name, location")
    .order("name");

  const linkedCourseIds = new Set(eventCourses.map((ec) => ec.course_id));
  const availableCourses = (allCourses ?? []).filter((c) => !linkedCourseIds.has(c.id));

  // Tee sets for courses linked to this event (for round add form)
  const { data: teesRaw } = await supabase
    .from("course_tees")
    .select("id, tee_name, course_id, courses(name)")
    .in("course_id", Array.from(linkedCourseIds).length > 0 ? Array.from(linkedCourseIds) : ["00000000-0000-0000-0000-000000000000"]);
  const tees = (teesRaw ?? []) as unknown as {
    id: string; tee_name: string; course_id: string;
    courses: { name: string } | null;
  }[];

  const { data: formats } = await supabase.from("formats").select("id, name").order("sort_order");

  const { data: roundsRaw } = await supabase
    .from("rounds")
    .select("id, round_number, name, side, played_at, status, course_tees(tee_name, courses(name)), formats(name)")
    .eq("event_id", params.id)
    .order("round_number");
  const rounds = (roundsRaw ?? []) as unknown as {
    id: string; round_number: number; name: string | null;
    side: string; played_at: string | null; status: string;
    course_tees: { tee_name: string; courses: { name: string } | null } | null;
    formats: { name: string } | null;
  }[];

  const { data: participantsRaw } = await supabase
    .from("event_participants")
    .select("id, display_name, is_captain, team_id, players(id, name, current_index), teams(name, color)")
    .eq("event_id", params.id)
    .order("display_name");
  const participants = (participantsRaw ?? []) as unknown as {
    id: string; display_name: string; is_captain: boolean; team_id: string | null;
    players: { id: string; name: string; current_index: number | null } | null;
    teams: { name: string; color: string } | null;
  }[];

  // Scoreboard: matchup results for all rounds in this event
  const roundIds = rounds.map((r) => r.id);
  const { data: matchupResults } = roundIds.length > 0
    ? await supabase
        .from("matchups")
        .select("round_id, result")
        .in("round_id", roundIds)
        .not("result", "is", null)
    : { data: [] };

  // Aggregate points per team per round
  // home = teams[0] (alphabetically), away = teams[1]
  const sortedTeams = [...(teams ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const homeTeam = sortedTeams[0];
  const awayTeam = sortedTeams[1];

  // pts[teamId][roundId] = points
  const pts: Record<string, Record<string, number>> = {};
  if (homeTeam) pts[homeTeam.id] = {};
  if (awayTeam) pts[awayTeam.id] = {};

  for (const m of matchupResults ?? []) {
    if (!m.result || !m.round_id) continue;
    if (homeTeam) pts[homeTeam.id][m.round_id] = (pts[homeTeam.id][m.round_id] ?? 0) + (m.result === "home" ? 1 : m.result === "halve" ? 0.5 : 0);
    if (awayTeam) pts[awayTeam.id][m.round_id] = (pts[awayTeam.id][m.round_id] ?? 0) + (m.result === "away" ? 1 : m.result === "halve" ? 0.5 : 0);
  }

  function fmtPts(n: number | undefined) {
    if (n === undefined) return "—";
    if (n === 0.5) return "½";
    if (n % 1 === 0.5) return `${Math.floor(n)}½`;
    return String(n);
  }

  const countByTeam = participants.reduce<Record<string, number>>((acc, ep) => {
    if (ep.team_id) acc[ep.team_id] = (acc[ep.team_id] ?? 0) + 1;
    return acc;
  }, {});

  // The event's draft (one per event). Pool = non-captains with no team yet.
  const { data: draftRows } = await supabase
    .from("drafts").select("*").eq("event_id", params.id).limit(1);
  const draft = draftRows?.[0] ?? null;
  const captainCount = participants.filter((p) => p.is_captain).length;
  const poolCount = participants.filter((p) => !p.is_captain && !p.team_id).length;
  const draftReady = sortedTeams.length === 2 && captainCount >= 2 && poolCount > 0;
  const firstPickTeam = sortedTeams.find((t) => t.id === draft?.first_pick_team_id) ?? sortedTeams[0];

  // Players not yet in this event — candidates to drop into the draft pool
  const { data: allPlayers } = await supabase
    .from("players").select("id, name, nickname, current_index").order("name");
  const participantPlayerIds = new Set(
    participants.map((p) => p.players?.id).filter(Boolean),
  );
  const availablePlayers = (allPlayers ?? []).filter((p) => !participantPlayerIds.has(p.id));

  async function updateEvent(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("events").update({
      name:       formData.get("name") as string,
      location:   formData.get("location") as string || null,
      start_date: formData.get("start_date") as string || null,
      end_date:   formData.get("end_date") as string || null,
      status:     formData.get("status") as string,
    }).eq("id", params.id);
    failTo(`/admin/events/${params.id}`, error);
    revalidatePath(`/admin/events/${params.id}`);
    redirect(`/admin/events/${params.id}?section=details&saved=1`);
  }

  async function deleteEvent(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("events").delete().eq("id", formData.get("id") as string);
    failTo(`/admin/events/${params.id}`, error);
    redirect("/admin/events");
  }

  async function addTeam(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("teams").insert({
      event_id: params.id,
      name:     formData.get("name") as string,
      color:    formData.get("color") as string,
    });
    failTo(`/admin/events/${params.id}`, error);
    revalidatePath(`/admin/events/${params.id}`);
  }

  async function updateTeam(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("teams").update({
      name:  formData.get("name") as string,
      color: formData.get("color") as string,
    }).eq("id", formData.get("team_id") as string);
    failTo(`/admin/events/${params.id}`, error);
    revalidatePath(`/admin/events/${params.id}`);
    revalidatePath("/matches");
    redirect(`/admin/events/${params.id}?section=teams&saved=1`);
  }

  async function deleteTeam(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("teams").delete().eq("id", formData.get("team_id") as string);
    failTo(`/admin/events/${params.id}`, error);
    revalidatePath(`/admin/events/${params.id}`);
  }

  async function addEventCourse(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("event_courses").insert({
      event_id:  params.id,
      course_id: formData.get("course_id") as string,
    });
    failTo(`/admin/events/${params.id}`, error);
    revalidatePath(`/admin/events/${params.id}`);
  }

  async function removeEventCourse(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("event_courses").delete().eq("id", formData.get("event_course_id") as string);
    failTo(`/admin/events/${params.id}`, error);
    revalidatePath(`/admin/events/${params.id}`);
  }

  async function addRound(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { data: existing } = await supabase
      .from("rounds")
      .select("round_number")
      .eq("event_id", params.id)
      .order("round_number", { ascending: false })
      .limit(1);
    const nextNum = ((existing?.[0]?.round_number) ?? 0) + 1;
    const { error } = await supabase.from("rounds").insert({
      event_id:      params.id,
      course_tee_id: formData.get("course_tee_id") as string,
      format_id:     formData.get("format_id") as string,
      round_number:  nextNum,
      name:          formData.get("name") as string || null,
      side:          formData.get("side") as string,
      played_at:     formData.get("played_at") as string || null,
    });
    failTo(`/admin/events/${params.id}`, error);
    revalidatePath(`/admin/events/${params.id}`);
  }

  // Reorder: swap with the neighbour, then renumber the whole list 1..n.
  // (event_id, round_number) is unique and not deferrable, so the renumber
  // goes in two passes — park everything at +1000, then write the final
  // numbers. A failure mid-way leaves rounds at 1000+, which is obvious on
  // the page and fixed by any further move.
  async function moveRound(formData: FormData) {
    "use server";
    const supabase = createClient();
    const back = `/admin/events/${params.id}`;
    const roundId = formData.get("round_id") as string;
    const dir = formData.get("dir") === "up" ? -1 : 1;

    const { data: rows, error: readErr } = await supabase
      .from("rounds").select("id, round_number").eq("event_id", params.id).order("round_number");
    failTo(back, readErr);
    const order = (rows ?? []).map((r) => r.id);
    const i = order.indexOf(roundId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];

    for (const pass of [1000, 0]) {
      const results = await Promise.all(
        order.map((id, idx) =>
          supabase.from("rounds").update({ round_number: pass + idx + 1 }).eq("id", id),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) failTo(back, failed.error);
    }
    revalidatePath(back);
    revalidatePath("/matches");
    redirect(`${back}?saved=1`);
  }

  async function deleteRound(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("rounds").delete().eq("id", formData.get("round_id") as string);
    failTo(`/admin/events/${params.id}`, error);
    revalidatePath(`/admin/events/${params.id}`);
  }

  // Add a player to the event with no team — the draft pool. (Captains and
  // pre-assigned players still go on via the team roster pages.)
  async function addToPool(formData: FormData) {
    "use server";
    const supabase = createClient();
    const playerId = formData.get("player_id") as string;
    const { data: p } = await supabase.from("players").select("nickname, name").eq("id", playerId).single();
    const { error } = await supabase.from("event_participants").insert({
      event_id:     params.id,
      player_id:    playerId,
      team_id:      null,
      display_name: p?.nickname ?? p?.name ?? "",
      is_captain:   false,
    });
    failTo(`/admin/events/${params.id}`, error);
    revalidatePath(`/admin/events/${params.id}`);
    revalidatePath("/draft");
  }

  async function removeParticipant(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("event_participants").delete().eq("id", formData.get("ep_id") as string);
    failTo(`/admin/events/${params.id}`, error);
    revalidatePath(`/admin/events/${params.id}`);
    revalidatePath("/draft");
  }

  // ---- Draft (one per event; the room itself lives at /draft) ----
  async function saveDraft(formData: FormData) {
    "use server";
    const supabase = createClient();
    const id = formData.get("draft_id") as string;
    const scheduledLocal = formData.get("scheduled_at") as string;
    const fields = {
      scheduled_at: scheduledLocal ? new Date(scheduledLocal).toISOString() : null,
      pick_seconds: parseInt(formData.get("pick_seconds") as string) || 120,
      call_link: (formData.get("call_link") as string) || null,
    };
    const { error } = id
      ? await supabase.from("drafts").update(fields).eq("id", id)
      : await supabase.from("drafts").insert({ ...fields, event_id: params.id });
    failTo(`/admin/events/${params.id}`, error);
    revalidatePath(`/admin/events/${params.id}`);
    revalidatePath("/draft");
    revalidatePath("/");
  }

  async function setFirstPick(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("drafts")
      .update({ first_pick_team_id: formData.get("team_id") as string })
      .eq("id", formData.get("draft_id") as string);
    failTo(`/admin/events/${params.id}`, error);
    revalidatePath(`/admin/events/${params.id}`);
    revalidatePath("/draft");
  }

  async function startDraft(formData: FormData) {
    "use server";
    const supabase = createClient();
    const id = formData.get("draft_id") as string;
    const { error } = await supabase.from("drafts").update({
      status: "live",
      current_pick_started_at: new Date().toISOString(),
    }).eq("id", id);
    failTo(`/admin/events/${params.id}`, error);
    await recordDraftEvent(supabase, params.id,
      `🐉 The ${event.year} draft is LIVE — watch the picks!`);
    revalidatePath(`/admin/events/${params.id}`);
    revalidatePath("/draft");
    revalidatePath("/");
    redirect("/draft");
  }

  async function resetDraft(formData: FormData) {
    "use server";
    const supabase = createClient();
    const id = formData.get("draft_id") as string;
    const { data: picks, error: picksError } = await supabase
      .from("draft_picks").select("participant_id").eq("draft_id", id);
    failTo(`/admin/events/${params.id}`, picksError);
    const ids = (picks ?? []).map((p) => p.participant_id);
    if (ids.length) {
      // Drafted players go back in the pool; captains keep their teams.
      const { error } = await supabase.from("event_participants")
        .update({ team_id: null }).in("id", ids);
      failTo(`/admin/events/${params.id}`, error);
    }
    const { error: delError } = await supabase.from("draft_picks").delete().eq("draft_id", id);
    failTo(`/admin/events/${params.id}`, delError);
    const { error: stError } = await supabase.from("drafts")
      .update({ status: "scheduled", current_pick_started_at: null }).eq("id", id);
    failTo(`/admin/events/${params.id}`, stError);
    revalidatePath(`/admin/events/${params.id}`);
    revalidatePath("/draft");
    revalidatePath("/");
  }

  async function deleteDraft(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("drafts").delete().eq("id", formData.get("draft_id") as string);
    failTo(`/admin/events/${params.id}`, error);
    revalidatePath(`/admin/events/${params.id}`);
    revalidatePath("/draft");
    revalidatePath("/");
  }

  // Finish a live draft that won't auto-complete (e.g. some players were
  // never drafted). Keeps whatever team assignments were made.
  async function completeDraft(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("drafts")
      .update({ status: "complete", current_pick_started_at: null })
      .eq("id", formData.get("draft_id") as string);
    failTo(`/admin/events/${params.id}`, error);
    revalidatePath(`/admin/events/${params.id}`);
    revalidatePath("/draft");
    revalidatePath("/");
  }

  const sideLabel: Record<string, string> = { front: "Front 9", back: "Back 9", full: "Full 18" };
  const draftInputCls = "w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy";

  const section = ["teams", "details", "draft"].includes(searchParams.section ?? "")
    ? (searchParams.section as string)
    : "schedule";

  return (
    <div className="px-4 py-6 space-y-6">
      <Link href="/admin/events" className="text-sm text-navy/50 hover:text-navy">← Events</Link>
      <h1 className="text-2xl font-display font-bold text-navy">{event.name}</h1>
      <ErrorBanner message={searchParams.error} />

      {/* Section tabs */}
      <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
        {([["schedule", "Schedule"], ["teams", "Teams"], ["details", "Details"], ["draft", "Draft"]] as const).map(([s, label]) => (
          <Link key={s} href={`/admin/events/${params.id}?section=${s}`}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold ${
              section === s ? "bg-navy text-off-white border-navy" : "bg-white text-navy/60 border-hairline"
            }`}>
            {label}
          </Link>
        ))}
      </div>

      {section === "details" && (
      <>
      {/* Edit event */}
      <form action={updateEvent} className="rounded-xl border border-hairline bg-parchment p-4 space-y-3">
        <p className="font-semibold text-navy text-sm">Event Details</p>
        <input name="name" required defaultValue={event.name} placeholder="Event name"
          className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="location" defaultValue={event.location ?? ""} placeholder="Location"
          className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <div className="flex gap-2">
          <input name="start_date" type="date" defaultValue={event.start_date ?? ""}
            className="flex-1 rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
          <input name="end_date" type="date" defaultValue={event.end_date ?? ""}
            className="flex-1 rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        </div>
        <select name="status" defaultValue={event.status}
          className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="complete">Complete</option>
        </select>
        <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
          Save Changes
        </button>
      </form>

      {/* Scoreboard */}
      {rounds.length > 0 && homeTeam && awayTeam && (
        <div className="space-y-2">
          <p className="font-semibold text-navy">Scoreboard</p>
          <div className="overflow-x-auto rounded-xl border border-hairline">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-hairline">
                  <th className="text-left px-4 py-2 text-xs font-semibold text-navy/50 uppercase tracking-wide w-24">Team</th>
                  {rounds.map((r) => (
                    <th key={r.id} className="text-center px-3 py-2 text-xs font-semibold text-navy/50 uppercase tracking-wide min-w-[3rem]">
                      R{r.round_number}
                    </th>
                  ))}
                  <th className="text-center px-3 py-2 text-xs font-semibold text-navy/50 uppercase tracking-wide min-w-[3.5rem]">Total</th>
                </tr>
              </thead>
              <tbody>
                {[homeTeam, awayTeam].map((team) => {
                  const roundPts = pts[team.id] ?? {};
                  const total = Object.values(roundPts).reduce((s, v) => s + v, 0);
                  return (
                    <tr key={team.id} className="border-b border-hairline last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: team.color }} />
                          <span className="font-bold text-navy">{team.name}</span>
                        </div>
                      </td>
                      {rounds.map((r) => (
                        <td key={r.id} className="text-center px-3 py-3 font-semibold text-navy">
                          {fmtPts(roundPts[r.id])}
                        </td>
                      ))}
                      <td className="text-center px-3 py-3 font-bold text-navy text-base">
                        {fmtPts(total || undefined)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>
      )}

      {section === "schedule" && (
      <>
      {/* Courses */}
      <div className="space-y-3">
        <p className="font-semibold text-navy">Courses</p>
        {eventCourses.length === 0 && (
          <p className="text-sm text-navy/40">No courses added yet.</p>
        )}
        {eventCourses.map((ec) => {
          const course = ec.courses as { id: string; name: string; location: string | null } | null;
          return (
            <div key={ec.id} className="flex items-center justify-between rounded-xl border border-hairline bg-white px-4 py-3">
              <div>
                <p className="font-semibold text-navy">{course?.name}</p>
                {course?.location && <p className="text-xs text-navy/50">{course.location}</p>}
              </div>
              <DeleteButton
                action={removeEventCourse}
                fields={{ event_course_id: ec.id }}
                confirm={`Remove "${course?.name}" from this event?`}
                label="Remove"
                className="text-xs text-usa-red hover:underline"
              />
            </div>
          );
        })}
        {availableCourses.length > 0 ? (
          <form action={addEventCourse} className="flex gap-2">
            <select name="course_id" required
              className="flex-1 rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
              <option value="">Add a course…</option>
              {availableCourses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button type="submit" className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-off-white">
              Add
            </button>
          </form>
        ) : (
          <p className="text-sm text-navy/40">All courses in the library are linked to this event.</p>
        )}
      </div>

      {/* Rounds */}
      <div className="space-y-3">
        <p className="font-semibold text-navy">Rounds</p>
        {rounds.length === 0 && (
          <p className="text-sm text-navy/40">No rounds added yet.</p>
        )}
        {rounds.map((r, idx) => (
          <div key={r.id} className="flex items-center justify-between rounded-xl border border-hairline bg-white px-4 py-3">
            <div className="flex items-center gap-3">
              {/* Reorder arrows — renumbers the rounds */}
              <div className="flex flex-col">
                {(["up", "down"] as const).map((dir) => {
                  const disabled = dir === "up" ? idx === 0 : idx === rounds.length - 1;
                  return (
                    <form key={dir} action={moveRound}>
                      <input type="hidden" name="round_id" value={r.id} />
                      <input type="hidden" name="dir" value={dir} />
                      <button type="submit" disabled={disabled} aria-label={`Move round ${dir}`}
                        className="block px-1 text-xs leading-4 text-navy/40 hover:text-navy disabled:opacity-20 disabled:hover:text-navy/40">
                        {dir === "up" ? "▲" : "▼"}
                      </button>
                    </form>
                  );
                })}
              </div>
              <div>
              <p className="font-semibold text-navy">
                Round {r.round_number}{r.name ? ` — ${r.name}` : ""}
              </p>
              <p className="text-xs text-navy/50">
                {r.course_tees?.courses?.name} · {r.course_tees?.tee_name} Tees · {sideLabel[r.side]} · {r.formats?.name}
                {r.played_at ? ` · ${r.played_at}` : ""}
              </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link href={`/admin/events/${params.id}/rounds/${r.id}/matchups`}
                className="text-sm text-navy/60 hover:text-navy">
                Matchups ›
              </Link>
              <Link href={`/admin/events/${params.id}/rounds/${r.id}`}
                className="text-sm text-navy/60 hover:text-navy">
                Edit ›
              </Link>
              <DeleteButton
                action={deleteRound}
                fields={{ round_id: r.id }}
                confirm={`Delete Round ${r.round_number}?`}
                label="Delete"
                className="text-xs text-usa-red hover:underline"
              />
            </div>
          </div>
        ))}

        {tees.length > 0 && (
          <Collapsible label="Add Round">
          <form action={addRound} className="rounded-xl border border-dashed border-hairline p-4 space-y-3">
            <p className="font-semibold text-navy text-sm">Add Round</p>
            <input name="name" placeholder="Label (optional, e.g. Morning)"
              className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
            <select name="course_tee_id" required
              className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
              <option value="">Select tee set…</option>
              {tees.map((t) => (
                <option key={t.id} value={t.id}>{t.courses?.name} — {t.tee_name} Tees</option>
              ))}
            </select>
            <select name="format_id" required
              className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
              <option value="">Select format…</option>
              {(formats ?? []).map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <select name="side" required
                className="flex-1 rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
                <option value="full">Full 18</option>
                <option value="front">Front 9</option>
                <option value="back">Back 9</option>
              </select>
              <input name="played_at" type="date"
                className="flex-1 rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
            </div>
            <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
              Add Round
            </button>
          </form>
          </Collapsible>
        )}
        {tees.length === 0 && (
          <p className="text-sm text-navy/40">Add a course above before creating rounds.</p>
        )}
      </div>
      </>
      )}

      {section === "teams" && (
      <>
      {/* Teams */}
      <div className="space-y-3">
        <p className="font-semibold text-navy">Teams</p>
        <EventTeamList
          eventId={params.id}
          teams={(teams ?? []).map((team) => ({
            id: team.id,
            name: team.name,
            color: team.color,
            count: countByTeam[team.id] ?? 0,
          }))}
          updateTeam={updateTeam}
          deleteTeam={deleteTeam}
        />

        <Collapsible label="Add Team">
          <form action={addTeam} className="rounded-xl border border-dashed border-hairline p-4 space-y-3">
            <p className="font-semibold text-navy text-sm">Add Team</p>
            <input name="name" required placeholder="Team name (e.g. USA)"
              className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
            <div className="flex items-center gap-3">
              <label className="text-sm text-navy/60">Color</label>
              <input name="color" type="color" defaultValue="#0C2D55"
                className="h-9 w-16 rounded border border-hairline cursor-pointer" />
            </div>
            <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
              Add Team
            </button>
          </form>
        </Collapsible>
      </div>

      {/* Participants */}
      <div className="space-y-3">
        <p className="font-semibold text-navy">Participants · {participants.length}</p>
        <p className="text-sm text-navy/50 -mt-1">
          Add draft-pool players here (no team — they&rsquo;ll be drafted). Captains
          and pre-set players go on via the team rosters above.
        </p>
        {participants.length === 0 && (
          <p className="text-sm text-navy/40">No participants yet.</p>
        )}
        {participants.length > 0 && (
          <div className="rounded-xl border border-hairline bg-white divide-y divide-hairline">
            {participants.map((ep) => (
              <div key={ep.id} className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-2">
                  {ep.teams ? (
                    <span
                      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: ep.teams.color }}
                    />
                  ) : (
                    <span className="inline-block w-2 h-2 rounded-full flex-shrink-0 border border-navy/30" />
                  )}
                  <span className="text-sm font-medium text-navy">{ep.display_name}</span>
                  {ep.is_captain && <span className="text-xs text-navy/40">C</span>}
                </div>
                <div className="flex items-center gap-3 text-xs text-navy/40">
                  {ep.teams ? (
                    <span>{ep.teams.name}</span>
                  ) : (
                    <span className="rounded-full bg-navy/10 px-2 py-0.5 font-semibold text-navy/60">Pool</span>
                  )}
                  <span>idx {ep.players?.current_index ?? "—"}</span>
                  {/* Only pool players are removable here; team members via rosters */}
                  {!ep.team_id && (
                    <DeleteButton
                      action={removeParticipant}
                      fields={{ ep_id: ep.id }}
                      confirm={`Remove ${ep.display_name} from the draft pool?`}
                      label="Remove"
                      className="text-xs text-usa-red hover:underline"
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add to draft pool */}
        {availablePlayers.length > 0 ? (
          <form action={addToPool} className="rounded-xl border border-dashed border-hairline p-4 space-y-3">
            <p className="font-semibold text-navy text-sm">Add to Draft Pool</p>
            <select name="player_id" required
              className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy bg-white">
              <option value="">Select player…</option>
              {availablePlayers.map((ap) => (
                <option key={ap.id} value={ap.id}>
                  {ap.name}{ap.nickname ? ` (${ap.nickname})` : ""} · {ap.current_index ?? "no index"}
                </option>
              ))}
            </select>
            <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
              Add to Pool
            </button>
          </form>
        ) : (
          <p className="text-sm text-navy/40">Every player is already in this event.</p>
        )}
      </div>
      </>
      )}

      {section === "draft" && (
      <>
      {/* Draft */}
      <div className="space-y-3">
        <Link href="/draft/prep"
          className="flex items-center justify-between rounded-xl border border-hairline bg-white px-4 py-3 transition-colors hover:bg-parchment">
          <div>
            <p className="font-semibold text-navy">📋 Draft Prep Sheet</p>
            <p className="text-xs text-navy/50">Indexes &amp; course handicaps for the field · calculate handicaps</p>
          </div>
          <span className="text-navy/30">›</span>
        </Link>

        <div className="flex items-center justify-between">
          <p className="font-semibold text-navy">Draft</p>
          {draft && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
              draft.status === "live" ? "bg-gold text-navy"
              : draft.status === "complete" ? "bg-europe-green text-white"
              : "bg-navy/10 text-navy/60"
            }`}>
              {draft.status}
            </span>
          )}
        </div>

        {!draft ? (
          <form action={saveDraft} className="rounded-xl border border-dashed border-hairline p-4 space-y-3">
            <p className="text-sm text-navy/50">
              Set up a snake draft to fill the rosters. The pool is this event&rsquo;s
              participants with no team yet; captains must already be on their teams.
            </p>
            <label className="block text-xs text-navy/50">
              Draft day &amp; time
              <LocalDateTimeInput name="scheduled_at" iso={null} className={`${draftInputCls} mt-1`} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-navy/50">
                Pick clock (seconds, soft)
                <input name="pick_seconds" type="number" min={15} defaultValue={120} className={`${draftInputCls} mt-1`} />
              </label>
              <label className="block text-xs text-navy/50">
                Call link (FaceTime/Zoom)
                <input name="call_link" type="url" placeholder="https://…" className={`${draftInputCls} mt-1`} />
              </label>
            </div>
            <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
              Create Draft
            </button>
          </form>
        ) : (
          <div className="rounded-xl border border-hairline bg-white p-4 space-y-4">
            {/* settings */}
            <form action={saveDraft} className="space-y-3">
              <input type="hidden" name="draft_id" value={draft.id} />
              <label className="block text-xs text-navy/50">
                Draft day &amp; time
                <LocalDateTimeInput name="scheduled_at" iso={draft.scheduled_at} className={`${draftInputCls} mt-1`} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs text-navy/50">
                  Pick clock (seconds, soft)
                  <input name="pick_seconds" type="number" min={15}
                    defaultValue={draft.pick_seconds} className={`${draftInputCls} mt-1`} />
                </label>
                <label className="block text-xs text-navy/50">
                  Call link (FaceTime/Zoom)
                  <input name="call_link" type="url" placeholder="https://…"
                    defaultValue={draft.call_link ?? ""} className={`${draftInputCls} mt-1`} />
                </label>
              </div>
              <button type="submit" className="w-full rounded-lg bg-navy/90 py-2 text-sm font-semibold text-off-white">
                Save Draft Settings
              </button>
            </form>

            {/* first pick */}
            {draft.status === "scheduled" && sortedTeams.length === 2 && (
              <div className="flex items-center gap-2 border-t border-hairline pt-3">
                <p className="text-xs text-navy/50">First pick:</p>
                {sortedTeams.map((t) => (
                  <form key={t.id} action={setFirstPick}>
                    <input type="hidden" name="draft_id" value={draft.id} />
                    <input type="hidden" name="team_id" value={t.id} />
                    <button type="submit"
                      className={`rounded-full px-3 py-1 text-xs font-bold text-white ${
                        firstPickTeam?.id === t.id ? "" : "opacity-35"
                      }`}
                      style={{ backgroundColor: t.color }}>
                      {t.name}{firstPickTeam?.id === t.id ? " ✓" : ""}
                    </button>
                  </form>
                ))}
              </div>
            )}

            {/* readiness / start */}
            {draft.status === "scheduled" && !draftReady && (
              <p className="rounded-lg bg-gold/15 px-3 py-2 text-xs text-navy/70">
                Before starting: 2 teams ({sortedTeams.length}), captains on both
                ({captainCount}), and undrafted players in the pool ({poolCount}).
              </p>
            )}

            <div className="flex items-center gap-3 border-t border-hairline pt-3">
              {draft.status === "scheduled" && draftReady && (
                <form action={startDraft} className="flex-1">
                  <input type="hidden" name="draft_id" value={draft.id} />
                  <button type="submit"
                    className="w-full rounded-lg bg-europe-green py-2 text-sm font-bold text-white">
                    🐉 Start the Draft
                  </button>
                </form>
              )}
              {draft.status !== "scheduled" && (
                <>
                  <Link href="/draft"
                    className="flex-1 rounded-lg bg-navy py-2 text-center text-sm font-semibold text-off-white">
                    Open Draft Room
                  </Link>
                  <DeleteButton
                    action={resetDraft}
                    fields={{ draft_id: draft.id }}
                    confirm="Reset the draft? All picks are erased and drafted players go back into the pool (captains keep their teams)."
                    label="Reset"
                    className="rounded-lg border border-usa-red/40 px-3 py-2 text-sm font-semibold text-usa-red"
                  />
                </>
              )}
              {draft.status === "scheduled" && (
                <DeleteButton
                  action={deleteDraft}
                  fields={{ draft_id: draft.id }}
                  confirm="Delete this draft? Any team assignments already made stay on the rosters."
                  label="Delete"
                  className="text-sm text-usa-red hover:underline"
                />
              )}
            </div>

            {draft.status === "live" && (
              <form action={completeDraft}>
                <input type="hidden" name="draft_id" value={draft.id} />
                <button type="submit"
                  className="w-full rounded-lg bg-europe-green py-2 text-sm font-bold text-white">
                  ✓ Mark draft complete
                </button>
                <p className="mt-1 text-center text-[11px] text-navy/45">
                  Ends the LIVE draft and keeps the current rosters (use this if some players won&rsquo;t be drafted).
                </p>
              </form>
            )}
          </div>
        )}
      </div>
      </>
      )}

      {/* Delete event — lives on the Details tab */}
      {section === "details" && (
        <DeleteButton
          action={deleteEvent}
          fields={{ id: event.id }}
          confirm={`Delete "${event.name}" and all its teams, rosters, and match data? This cannot be undone.`}
          label="Delete event"
          className="text-sm text-usa-red hover:underline"
        />
      )}
    </div>
  );
}
