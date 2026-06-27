import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export default async function AdminEventsPage() {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const supabase = createClient();
  const { data: events } = await supabase
    .from("events")
    .select("*")
    .order("year", { ascending: false });

  async function addEvent(formData: FormData) {
    "use server";
    const supabase = createClient();
    await supabase.from("events").insert({
      year:       parseInt(formData.get("year") as string),
      name:       formData.get("name") as string,
      location:   formData.get("location") as string,
      start_date: formData.get("start_date") as string || null,
      end_date:   formData.get("end_date") as string || null,
      status:     "draft",
    });
    revalidatePath("/admin/events");
  }

  async function setActive(formData: FormData) {
    "use server";
    const supabase = createClient();
    const id = formData.get("id") as string;
    await supabase.from("events").update({ status: "draft" }).neq("id", id);
    await supabase.from("events").update({ status: "active" }).eq("id", id);
    revalidatePath("/admin/events");
  }

  const statusColor: Record<string, string> = {
    draft:    "text-navy/40",
    active:   "text-europe-green font-semibold",
    complete: "text-navy/40",
  };

  return (
    <div className="px-4 py-6 space-y-6">
      <h1 className="text-2xl font-display font-bold text-navy">Events</h1>

      <form action={addEvent} className="rounded-xl border border-hairline bg-parchment p-4 space-y-3">
        <p className="font-semibold text-navy text-sm">New Event</p>
        <input name="year"       required placeholder="Year (e.g. 2026)"  type="number" className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="name"       required placeholder="Event name"                      className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="location"            placeholder="Location"                        className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="start_date"          placeholder="Start date" type="date"          className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="end_date"            placeholder="End date"   type="date"          className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
          Create Event
        </button>
      </form>

      <ul className="space-y-2">
        {events?.map((e) => (
          <li key={e.id} className="rounded-xl border border-hairline bg-white px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-navy">{e.name}</p>
                <p className="text-xs text-navy/50">{e.location} · {e.year}</p>
              </div>
              <span className={`text-xs uppercase ${statusColor[e.status]}`}>{e.status}</span>
            </div>
            {e.status !== "active" && (
              <form action={setActive}>
                <input type="hidden" name="id" value={e.id} />
                <button type="submit" className="text-xs text-usa-red underline">
                  Set as active
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
