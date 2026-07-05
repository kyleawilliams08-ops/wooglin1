import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { ErrorBanner } from "@/components/ErrorBanner";
import { failTo } from "@/lib/actionError";

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
    </div>
  );
}
