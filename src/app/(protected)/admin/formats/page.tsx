import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";

export default async function AdminFormatsPage() {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const supabase = createClient();
  const { data: formats } = await supabase
    .from("formats")
    .select("*")
    .order("sort_order");

  async function updateFormat(formData: FormData) {
    "use server";
    const supabase = createClient();
    const secondary = formData.get("hcp_allowance_secondary") as string;
    await supabase.from("formats").update({
      hcp_allowance:           parseInt(formData.get("hcp_allowance") as string),
      hcp_allowance_secondary: secondary ? parseInt(secondary) : null,
    }).eq("id", formData.get("id") as string);
    revalidatePath("/admin/formats");
  }

  return (
    <div className="px-4 py-6 space-y-4">
      <Link href="/admin" className="text-sm text-navy/50 hover:text-navy">← Admin</Link>
      <h1 className="text-2xl font-display font-bold text-navy">Formats</h1>
      <p className="text-sm text-navy/50">Adjust the handicap allowance applied for each format.</p>

      <ul className="space-y-2">
        {(formats ?? []).map((f) => (
          <li key={f.id} className="rounded-xl border border-hairline bg-white px-4 py-3 space-y-2">
            <div>
              <p className="font-semibold text-navy">{f.name}</p>
              <p className="text-xs text-navy/50">{f.description}</p>
            </div>
            <form action={updateFormat} className="flex items-center gap-2 flex-wrap">
              <input type="hidden" name="id" value={f.id} />
              <div className="flex items-center gap-2">
                <span className="text-xs text-navy/50">{f.hcp_allowance_secondary != null ? "Low HCP" : "Allowance"}</span>
                <div className="relative w-24">
                  <input
                    name="hcp_allowance"
                    type="number"
                    min="0"
                    max="100"
                    defaultValue={f.hcp_allowance}
                    className="w-full rounded-lg border border-hairline px-3 py-1.5 text-sm text-navy pr-6"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-navy/40">%</span>
                </div>
              </div>
              {f.hcp_allowance_secondary != null && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-navy/50">High HCP</span>
                  <div className="relative w-24">
                    <input
                      name="hcp_allowance_secondary"
                      type="number"
                      min="0"
                      max="100"
                      defaultValue={f.hcp_allowance_secondary}
                      className="w-full rounded-lg border border-hairline px-3 py-1.5 text-sm text-navy pr-6"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-navy/40">%</span>
                  </div>
                </div>
              )}
              <button type="submit" className="rounded-lg bg-navy px-4 py-1.5 text-sm font-semibold text-off-white">
                Save
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
