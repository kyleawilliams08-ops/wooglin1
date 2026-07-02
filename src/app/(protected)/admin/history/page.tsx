import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { DeleteButton } from "@/components/DeleteButton";

export default async function AdminHistoryPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const supabase = createClient();
  const { data: results } = await supabase
    .from("event_results")
    .select("*")
    .order("year", { ascending: false });

  async function addResult(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { error } = await supabase.from("event_results").upsert({
      year:        parseInt(formData.get("year") as string),
      winner:      formData.get("winner") as string,
      final_score: (formData.get("final_score") as string) || null,
      location:    (formData.get("location") as string) || null,
      captains:    (formData.get("captains") as string) || null,
      roster:      (formData.get("roster") as string) || null,
      notes:       (formData.get("notes") as string) || null,
    }, { onConflict: "year" });
    if (error) {
      redirect(`/admin/history?error=${encodeURIComponent(error.message)}`);
    }
    revalidatePath("/admin/history");
    revalidatePath("/history");
  }

  async function deleteResult(formData: FormData) {
    "use server";
    const supabase = createClient();
    await supabase.from("event_results").delete().eq("id", formData.get("id") as string);
    revalidatePath("/admin/history");
    revalidatePath("/history");
  }

  const inputCls = "w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy";

  return (
    <div className="px-4 py-6 space-y-6">
      <Link href="/admin" className="text-sm text-navy/50 hover:text-navy">← Admin</Link>
      <h1 className="text-2xl font-display font-bold text-navy">History</h1>
      <p className="text-sm text-navy/50 -mt-4">
        Backfill past cups. Re-submitting a year updates that year&rsquo;s entry.
      </p>

      <form action={addResult} className="rounded-xl border border-hairline bg-parchment p-4 space-y-3">
        <p className="font-semibold text-navy text-sm">Add / update a year</p>
        {searchParams.error && (
          <p className="rounded-lg bg-usa-red/10 px-3 py-2 text-sm text-usa-red">{searchParams.error}</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <input name="year" required placeholder="Year (e.g. 2019)" type="number" className={inputCls} />
          <select name="winner" required defaultValue="" className={`${inputCls} bg-white`}>
            <option value="" disabled>Winner…</option>
            <option value="USA">USA</option>
            <option value="Europe">Europe</option>
            <option value="Tie">Tie</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input name="final_score" placeholder="Final score (e.g. 14.5 – 13.5)" className={inputCls} />
          <input name="location"    placeholder="Location" className={inputCls} />
        </div>
        <input name="captains" placeholder="Captains (e.g. Ryan (USA) · Brendan (Europe))" className={inputCls} />
        <textarea name="roster" placeholder="Roster (free text)" rows={2} className={inputCls} />
        <textarea name="notes"  placeholder="Notes" rows={2} className={inputCls} />
        <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
          Save Year
        </button>
      </form>

      <ul className="space-y-2">
        {results?.map((r) => (
          <li key={r.id} className="flex items-center justify-between rounded-xl border border-hairline bg-white px-4 py-3">
            <div>
              <p className="font-semibold text-navy">
                {r.year} — {r.winner}{r.final_score ? ` (${r.final_score})` : ""}
              </p>
              <p className="text-xs text-navy/50">{r.location ?? "—"}</p>
            </div>
            <DeleteButton
              action={deleteResult}
              fields={{ id: r.id }}
              confirm={`Delete the ${r.year} entry?`}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
