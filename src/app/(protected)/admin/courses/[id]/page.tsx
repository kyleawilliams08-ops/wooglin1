import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Collapsible } from "@/components/Collapsible";
import { TeeSetList } from "./TeeSetList";
import { failTo } from "@/lib/actionError";

export default async function CourseDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string };
}) {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const supabase = createClient();
  const { data: course } = await supabase.from("courses").select("*").eq("id", params.id).single();
  if (!course) redirect("/admin/courses");

  const { data: tees } = await supabase
    .from("course_tees")
    .select("*, holes(id)")
    .eq("course_id", params.id)
    .order("tee_name");

  async function updateCourse(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("courses").update({
      name:     formData.get("name") as string,
      location: formData.get("location") as string || null,
    }).eq("id", params.id);
    failTo(`/admin/courses/${params.id}`, error);
    revalidatePath(`/admin/courses/${params.id}`);
    redirect(`/admin/courses/${params.id}?saved=1`);
  }

  async function addTee(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("course_tees").insert({
      course_id: params.id,
      tee_name:  formData.get("tee_name") as string,
      rating:    parseFloat(formData.get("rating") as string),
      slope:     parseInt(formData.get("slope") as string),
      par:       parseInt(formData.get("par") as string),
    });
    failTo(`/admin/courses/${params.id}`, error);
    revalidatePath(`/admin/courses/${params.id}`);
    redirect(`/admin/courses/${params.id}?saved=1`);
  }

  async function updateTee(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("course_tees").update({
      tee_name: formData.get("tee_name") as string,
      rating:   parseFloat(formData.get("rating") as string),
      slope:    parseInt(formData.get("slope") as string),
      par:      parseInt(formData.get("par") as string),
    }).eq("id", formData.get("tee_id") as string);
    failTo(`/admin/courses/${params.id}`, error);
    revalidatePath(`/admin/courses/${params.id}`);
    redirect(`/admin/courses/${params.id}?saved=1`);
  }

  async function deleteTee(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("course_tees").delete().eq("id", formData.get("tee_id") as string);
    failTo(`/admin/courses/${params.id}`, error);
    revalidatePath(`/admin/courses/${params.id}`);
  }

  return (
    <div className="px-4 py-6 space-y-6">
      <Link href="/admin/courses" className="text-sm text-navy/50 hover:text-navy">← Courses</Link>
      <ErrorBanner message={searchParams.error} />

      {/* Edit course */}
      <form action={updateCourse} className="rounded-xl border border-hairline bg-parchment p-4 space-y-3">
        <p className="font-semibold text-navy text-sm">Course Details</p>
        <input name="name" required defaultValue={course.name} placeholder="Course name"
          className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="location" defaultValue={course.location ?? ""} placeholder="Location"
          className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
          Save
        </button>
      </form>

      {/* Tee sets */}
      <div className="space-y-3">
        <p className="font-semibold text-navy">Tee Sets</p>

        <TeeSetList
          courseId={params.id}
          tees={(tees ?? []).map((tee) => ({
            id: tee.id,
            tee_name: tee.tee_name,
            rating: tee.rating,
            slope: tee.slope,
            par: tee.par,
            holeCount: (tee.holes as { id: string }[])?.length ?? 0,
          }))}
          updateTee={updateTee}
          deleteTee={deleteTee}
        />

        <Collapsible label="Add Tee Set" defaultOpen={!!searchParams.error}>
          <form action={addTee} className="rounded-xl border border-dashed border-hairline p-4 space-y-3">
            <p className="font-semibold text-navy text-sm">Add Tee Set</p>
            <input name="tee_name" required placeholder="Tee name (e.g. Blue)"
              className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
            <div className="grid grid-cols-3 gap-2">
              <input name="rating" required placeholder="Rating" inputMode="decimal"
                className="rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
              <input name="slope" required placeholder="Slope" inputMode="numeric"
                className="rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
              <input name="par" required placeholder="Par" inputMode="numeric"
                className="rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
            </div>
            <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
              Add Tee Set
            </button>
          </form>
        </Collapsible>
      </div>
    </div>
  );
}
