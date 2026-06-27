import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";

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
      location:   formData.get("location") as string || null,
      start_date: formData.get("start_date") as string || null,
      end_date:   formData.get("end_date") as string || null,
      status:     "draft",
    });
    revalidatePath("/admin/events");
  }

  const statusColor: Record<string, string> = {
    draft:    "bg-hairline text-navy/60",
    active:   "bg-europe-green/20 text-europe-green",
    complete: "bg-navy/10 text-navy/40",
  };

  return (
    <div className="px-4 py-6 space-y-6">
      <h1 className="text-2xl font-display font-bold text-navy">Events</h1>

      <form action={addEvent} className="rounded-xl border border-hairline bg-parchment p-4 space-y-3">
        <p className="font-semibold text-navy text-sm">New Event</p>
        <input name="year"       required placeholder="Year (e.g. 2026)" type="number" className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="name"       required placeholder="Event name"                     className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="location"            placeholder="Location"                       className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="start_date"          placeholder="Start date" type="date"         className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="end_date"            placeholder="End date"   type="date"         className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
          Create Event
        </button>
      </form>

      <ul className="space-y-2">
        {events?.map((e) => (
          <li key={e.id}>
            <Link
              href={`/admin/events/${e.id}`}
              className="flex items-center justify-between rounded-xl border border-hairline bg-white px-4 py-4 hover:bg-parchment transition-colors"
            >
              <div>
                <p className="font-semibold text-navy">{e.name}</p>
                <p className="text-xs text-navy/50 mt-0.5">{e.location} · {e.year}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium uppercase ${statusColor[e.status]}`}>
                  {e.status}
                </span>
                <span className="text-navy/30">›</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
