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

  const { data: participantCounts } = await supabase
    .from("event_participants")
    .select("team_id")
    .eq("event_id", params.id)
;

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

  return (
    <div className="px-4 py-6 space-y-6">
      {/* Back */}
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
        {availableCourses.length > 0 && (
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

        {/* Add team */}
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
