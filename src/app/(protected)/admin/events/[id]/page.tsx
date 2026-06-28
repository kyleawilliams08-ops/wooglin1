import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { DeleteButton } from "@/components/DeleteButton";

export default async function EventDetailPage({ params }: { params: { id: string } }) {
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

  const { data: participantCounts } = await supabase
    .from("event_participants")
    .select("team_id")
    .eq("event_id", params.id);

  const countByTeam = (participantCounts ?? []).reduce<Record<string, number>>((acc, ep) => {
    if (ep.team_id) acc[ep.team_id] = (acc[ep.team_id] ?? 0) + 1;
    return acc;
  }, {});

  async function updateEvent(formData: FormData) {
    "use server";
    const supabase = createClient();
    await supabase.from("events").update({
      name:       formData.get("name") as string,
      location:   formData.get("location") as string || null,
      start_date: formData.get("start_date") as string || null,
      end_date:   formData.get("end_date") as string || null,
      status:     formData.get("status") as string,
    }).eq("id", params.id);
    revalidatePath(`/admin/events/${params.id}`);
  }

  async function deleteEvent(formData: FormData) {
    "use server";
    const supabase = createClient();
    await supabase.from("events").delete().eq("id", formData.get("id") as string);
    redirect("/admin/events");
  }

  async function addTeam(formData: FormData) {
    "use server";
    const supabase = createClient();
    await supabase.from("teams").insert({
      event_id: params.id,
      name:     formData.get("name") as string,
      color:    formData.get("color") as string,
    });
    revalidatePath(`/admin/events/${params.id}`);
  }

  async function deleteTeam(formData: FormData) {
    "use server";
    const supabase = createClient();
    await supabase.from("teams").delete().eq("id", formData.get("team_id") as string);
    revalidatePath(`/admin/events/${params.id}`);
  }

  async function addEventCourse(formData: FormData) {
    "use server";
    const supabase = createClient();
    await supabase.from("event_courses").insert({
      event_id:  params.id,
      course_id: formData.get("course_id") as string,
    });
    revalidatePath(`/admin/events/${params.id}`);
  }

  async function removeEventCourse(formData: FormData) {
    "use server";
    const supabase = createClient();
    await supabase.from("event_courses").delete().eq("id", formData.get("event_course_id") as string);
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
    await supabase.from("rounds").insert({
      event_id:      params.id,
      course_tee_id: formData.get("course_tee_id") as string,
      format_id:     formData.get("format_id") as string,
      round_number:  nextNum,
      name:          formData.get("name") as string || null,
      side:          formData.get("side") as string,
      played_at:     formData.get("played_at") as string || null,
    });
    revalidatePath(`/admin/events/${params.id}`);
  }

  async function deleteRound(formData: FormData) {
    "use server";
    const supabase = createClient();
    await supabase.from("rounds").delete().eq("id", formData.get("round_id") as string);
    revalidatePath(`/admin/events/${params.id}`);
  }

  const sideLabel: Record<string, string> = { front: "Front 9", back: "Back 9", full: "Full 18" };

  return (
    <div className="px-4 py-6 space-y-6">
      <Link href="/admin/events" className="text-sm text-navy/50 hover:text-navy">← Events</Link>

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
        {rounds.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-xl border border-hairline bg-white px-4 py-3">
            <div>
              <p className="font-semibold text-navy">
                Round {r.round_number}{r.name ? ` — ${r.name}` : ""}
              </p>
              <p className="text-xs text-navy/50">
                {r.course_tees?.courses?.name} · {r.course_tees?.tee_name} Tees · {sideLabel[r.side]} · {r.formats?.name}
                {r.played_at ? ` · ${r.played_at}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-3">
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
        )}
        {tees.length === 0 && (
          <p className="text-sm text-navy/40">Add a course above before creating rounds.</p>
        )}
      </div>

      {/* Teams */}
      <div className="space-y-3">
        <p className="font-semibold text-navy">Teams</p>
        {teams?.map((team) => {
          const count = countByTeam[team.id] ?? 0;
          return (
            <div key={team.id} className="flex items-center justify-between rounded-xl border border-hairline bg-white px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: team.color }} />
                <div>
                  <p className="font-semibold text-navy">{team.name}</p>
                  <p className="text-xs text-navy/50">{count} player{count !== 1 ? "s" : ""}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Link href={`/admin/events/${params.id}/teams/${team.id}`}
                  className="text-sm text-navy/60 hover:text-navy">
                  Manage roster ›
                </Link>
                <DeleteButton
                  action={deleteTeam}
                  fields={{ team_id: team.id }}
                  confirm={`Delete team "${team.name}" and all its roster data?`}
                  label="Delete"
                  className="text-xs text-usa-red hover:underline"
                />
              </div>
            </div>
          );
        })}

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
      </div>

      {/* Delete event */}
      <DeleteButton
        action={deleteEvent}
        fields={{ id: event.id }}
        confirm={`Delete "${event.name}" and all its teams, rosters, and match data? This cannot be undone.`}
        label="Delete event"
        className="text-sm text-usa-red hover:underline"
      />
    </div>
  );
}
