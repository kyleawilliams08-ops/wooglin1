import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";

export default async function HolesPage({ params }: { params: { id: string; teeId: string } }) {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const supabase = createClient();
  const { data: tee } = await supabase
    .from("course_tees")
    .select("*, courses(name)")
    .eq("id", params.teeId)
    .single();
  if (!tee) redirect(`/admin/courses/${params.id}`);

  const { data: holes } = await supabase
    .from("holes")
    .select("*")
    .eq("course_tee_id", params.teeId)
    .order("hole_number");

  async function saveHoles(formData: FormData) {
    "use server";
    const supabase = createClient();
    const updates = Array.from({ length: 18 }, (_, i) => ({
      course_tee_id: params.teeId,
      hole_number:   i + 1,
      par:           parseInt(formData.get(`par_${i + 1}`) as string),
      stroke_index:  parseInt(formData.get(`si_${i + 1}`) as string),
    }));
    for (const h of updates) {
      await supabase.from("holes").upsert(h, { onConflict: "course_tee_id,hole_number" });
    }
    revalidatePath(`/admin/courses/${params.id}/tees/${params.teeId}`);
  }

  const holeMap = Object.fromEntries((holes ?? []).map((h) => [h.hole_number, h]));
  const course = tee.courses as { name: string } | null;

  return (
    <div className="px-4 py-6 space-y-6">
      <Link href={`/admin/courses/${params.id}`} className="text-sm text-navy/50 hover:text-navy">
        ← {course?.name}
      </Link>
      <div>
        <h1 className="text-2xl font-display font-bold text-navy">{tee.tee_name} Tees</h1>
        <p className="text-sm text-navy/50 mt-0.5">Rating {tee.rating} / Slope {tee.slope} / Par {tee.par}</p>
      </div>

      <form action={saveHoles} className="space-y-4">
        {[1, 2].map((half) => (
          <div key={half} className="rounded-xl border border-hairline overflow-hidden">
            <div className="bg-navy text-off-white px-4 py-2 text-xs font-semibold uppercase tracking-wide">
              {half === 1 ? "Front 9" : "Back 9"}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-parchment text-navy/60 text-xs">
                    <th className="px-3 py-2 text-left">Hole</th>
                    {Array.from({ length: 9 }, (_, i) => (half - 1) * 9 + i + 1).map((n) => (
                      <th key={n} className="px-2 py-2 text-center w-10">{n}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-hairline">
                    <td className="px-3 py-2 text-xs text-navy/60 font-medium">Par</td>
                    {Array.from({ length: 9 }, (_, i) => (half - 1) * 9 + i + 1).map((n) => (
                      <td key={n} className="px-1 py-1 text-center">
                        <input
                          name={`par_${n}`}
                          type="number"
                          min="3" max="5"
                          defaultValue={holeMap[n]?.par ?? 4}
                          className="w-9 rounded border border-hairline px-1 py-1 text-center text-sm text-navy"
                        />
                      </td>
                    ))}
                  </tr>
                  <tr className="border-t border-hairline">
                    <td className="px-3 py-2 text-xs text-navy/60 font-medium">SI</td>
                    {Array.from({ length: 9 }, (_, i) => (half - 1) * 9 + i + 1).map((n) => (
                      <td key={n} className="px-1 py-1 text-center">
                        <input
                          name={`si_${n}`}
                          type="number"
                          min="1" max="18"
                          defaultValue={holeMap[n]?.stroke_index ?? n}
                          className="w-9 rounded border border-hairline px-1 py-1 text-center text-sm text-navy"
                        />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ))}
        <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
          Save All Holes
        </button>
      </form>
    </div>
  );
}
