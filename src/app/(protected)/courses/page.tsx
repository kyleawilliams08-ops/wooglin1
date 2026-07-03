import { requirePlayer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// View-only course directory for all members. Admin editing lives at /admin/courses.
export default async function CoursesPage() {
  await requirePlayer();
  const supabase = createClient();

  const { data: coursesRaw } = await supabase
    .from("courses")
    .select("id, name, location, course_tees(id, tee_name, rating, slope, par)")
    .order("name");
  const courses = (coursesRaw ?? []) as unknown as {
    id: string; name: string; location: string | null;
    course_tees: { id: string; tee_name: string; rating: number; slope: number; par: number }[];
  }[];

  return (
    <div className="px-4 py-6 space-y-4">
      <h1 className="text-2xl font-display font-bold text-navy">Courses</h1>

      {courses.length === 0 && <p className="text-sm text-navy/50">No courses yet.</p>}

      <ul className="space-y-3">
        {courses.map((c) => (
          <li key={c.id} className="rounded-xl border border-hairline bg-white px-4 py-4">
            <p className="font-semibold text-navy">{c.name}</p>
            {c.location && <p className="text-xs text-navy/50 mt-0.5">{c.location}</p>}
            {c.course_tees.length > 0 && (
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-xs text-navy/40 uppercase tracking-wide">
                    <th className="text-left font-semibold pb-1">Tee</th>
                    <th className="text-right font-semibold pb-1">Rating</th>
                    <th className="text-right font-semibold pb-1">Slope</th>
                    <th className="text-right font-semibold pb-1">Par</th>
                  </tr>
                </thead>
                <tbody>
                  {c.course_tees.map((t) => (
                    <tr key={t.id} className="border-t border-hairline text-navy">
                      <td className="py-1.5">{t.tee_name}</td>
                      <td className="py-1.5 text-right tabular-nums">{t.rating}</td>
                      <td className="py-1.5 text-right tabular-nums">{t.slope}</td>
                      <td className="py-1.5 text-right tabular-nums">{t.par}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
