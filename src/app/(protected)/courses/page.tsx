import { requirePlayer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CourseList, type CourseView } from "@/components/CourseList";

// View-only course directory for all members. Admin editing lives at /admin/courses.
export default async function CoursesPage() {
  await requirePlayer();
  const supabase = createClient();

  const { data: coursesRaw } = await supabase
    .from("courses")
    .select("id, name, location, course_tees(id, tee_name, rating, slope, par)")
    .order("name");
  const courses = (coursesRaw ?? []) as unknown as CourseView[];

  return (
    <div className="px-4 py-6 space-y-4">
      <h1 className="text-2xl font-display font-bold text-navy">Courses</h1>
      <CourseList courses={courses} />
    </div>
  );
}
