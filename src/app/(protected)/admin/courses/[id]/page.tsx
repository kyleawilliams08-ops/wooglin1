import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { DeleteButton } from "@/components/DeleteButton";

export default async function CourseDetailPage({ params }: { params: { id: string } }) {
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
    await supabase.from("courses").update({
      name:     formData.get("name") as string,
      location: formData.get("location") as string || null,
    }).eq("id", params.id);
    revalidatePath(`/admin/courses/${params.id}`);
  }

  async function addTee(formData: FormData) {
    "use server";
    const supabase = createClient();
    await supabase.from("course_tees").insert({
      course_id: params.id,
      tee_name:  formData.get("tee_name") as string,
      rating:    parseFloat(formData.get("rating") as string),
      slope:     parseInt(formData.get("slope") as string),
      par:       parseInt(formData.get("par") as string),
    });
    revalidatePath(`/admin/courses/${params.id}`);
  }

  async function deleteTee(formData: FormData) {
    "use server";
    const supabase = createClient();
    await supabase.from("course_tees").delete().eq("id", formData.get("tee_id") as string);
    revalidatePath(`/admin/courses/${params.id}`);
  }

  return (
    <div className="px-4 py-6 space-y-6">
      <Link href="/admin/courses" className="text-sm text-navy/50 hover:text-navy">← Courses</Link>

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
        {tees?.map((tee) => {
          const holeCount = (tee.holes as { id: string }[])?.length ?? 0;
          return (
            <div key={tee.id} className="flex items-center justify-between rounded-xl border border-hairline bg-white px-4 py-3">
              <div>
                <p className="font-semibold text-navy">{tee.tee_name} Tees</p>
                <p className="text-xs text-navy/50">
                  Rating {tee.rating} / Slope {tee.slope} / Par {tee.par} · {holeCount} holes
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Link href={`/admin/courses/${params.id}/tees/${tee.id}`}
                  className="text-sm text-navy/60 hover:text-navy">
                  Holes ›
                </Link>
                <DeleteButton
                  action={deleteTee}
                  fields={{ tee_id: tee.id }}
                  confirm={`Delete "${tee.tee_name}" tees and all hole data?`}
                  label="Delete"
                  className="text-xs text-usa-red hover:underline"
                />
              </div>
            </div>
          );
        })}

        <form action={addTee} className="rounded-xl border border-dashed border-hairline p-4 space-y-3">
          <p className="font-semibold text-navy text-sm">Add Tee Set</p>
          <input name="tee_name" required placeholder="Tee name (e.g. Blue)"
            className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
          <div className="grid grid-cols-3 gap-2">
            <input name="rating" required placeholder="Rating" type="number" step="0.1"
              className="rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
            <input name="slope" required placeholder="Slope" type="number"
              className="rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
            <input name="par" required placeholder="Par" type="number"
              className="rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
          </div>
          <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
            Add Tee Set
          </button>
        </form>
      </div>
    </div>
  );
}
