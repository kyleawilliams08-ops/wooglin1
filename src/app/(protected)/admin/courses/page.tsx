import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { DeleteButton } from "@/components/DeleteButton";

export default async function AdminCoursesPage() {
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
    await supabase.from("courses").insert({
      name:     formData.get("name") as string,
      location: formData.get("location") as string || null,
    });
    revalidatePath("/admin/courses");
  }

  async function deleteCourse(formData: FormData) {
    "use server";
    const supabase = createClient();
    await supabase.from("courses").delete().eq("id", formData.get("id") as string);
    revalidatePath("/admin/courses");
  }

  return (
    <div className="px-4 py-6 space-y-6">
      <h1 className="text-2xl font-display font-bold text-navy">Courses</h1>

      <form action={addCourse} className="rounded-xl border border-hairline bg-parchment p-4 space-y-3">
        <p className="font-semibold text-navy text-sm">Add Course</p>
        <input name="name"     required placeholder="Course name" className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="location"          placeholder="Location"    className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
          Add Course
        </button>
      </form>

      <ul className="space-y-2">
        {courses?.map((c) => {
          const teeCount = (c.course_tees as { id: string }[])?.length ?? 0;
          return (
            <li key={c.id} className="flex items-center justify-between rounded-xl border border-hairline bg-white px-4 py-4">
              <div>
                <p className="font-semibold text-navy">{c.name}</p>
                <p className="text-xs text-navy/50">{c.location} · {teeCount} tee set{teeCount !== 1 ? "s" : ""}</p>
              </div>
              <div className="flex items-center gap-3">
                <Link href={`/admin/courses/${c.id}`} className="text-sm text-navy/60 hover:text-navy">
                  Manage ›
                </Link>
                <DeleteButton
                  action={deleteCourse}
                  fields={{ id: c.id }}
                  confirm={`Delete "${c.name}" and all its tee and hole data?`}
                  label="Delete"
                  className="text-xs text-usa-red hover:underline"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
