import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Collapsible } from "@/components/Collapsible";
import { AdminCourseList } from "./AdminCourseList";
import { failTo } from "@/lib/actionError";

export default async function AdminCoursesPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const supabase = createClient();
  const { data: courses } = await supabase
    .from("courses")
    .select("*, course_tees(id)")
    .order("name");

  async function addCourse(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("courses").insert({
      name:     formData.get("name") as string,
      location: formData.get("location") as string || null,
    });
    failTo("/admin/courses", error);
    revalidatePath("/admin/courses");
    redirect("/admin/courses?saved=1");
  }

  async function deleteCourse(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("courses").delete().eq("id", formData.get("id") as string);
    failTo("/admin/courses", error);
    revalidatePath("/admin/courses");
  }

  return (
    <div className="px-4 py-6 space-y-6">
      <h1 className="text-2xl font-display font-bold text-navy">Courses</h1>
      <ErrorBanner message={searchParams.error} />

      <Collapsible label="Add Course" defaultOpen={!!searchParams.error}>
        <form action={addCourse} className="rounded-xl border border-hairline bg-parchment p-4 space-y-3">
          <p className="font-semibold text-navy text-sm">Add Course</p>
          <input name="name"     required placeholder="Course name" className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
          <input name="location"          placeholder="Location"    className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
          <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
            Add Course
          </button>
        </form>
      </Collapsible>

      <AdminCourseList
        courses={(courses ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          location: c.location,
          teeCount: (c.course_tees as { id: string }[])?.length ?? 0,
        }))}
        deleteCourse={deleteCourse}
      />
    </div>
  );
}
