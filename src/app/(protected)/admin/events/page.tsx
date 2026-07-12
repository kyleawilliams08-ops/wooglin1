import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { EventList } from "./EventList";

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
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
    const { error } = await supabase.from("events").insert({
      year:       parseInt(formData.get("year") as string),
      name:       formData.get("name") as string,
      location:   formData.get("location") as string || null,
      start_date: formData.get("start_date") as string || null,
      end_date:   formData.get("end_date") as string || null,
      status:     "draft",
    });
    if (error) {
      redirect(`/admin/events?error=${encodeURIComponent(error.message)}`);
    }
    revalidatePath("/admin/events");
    redirect("/admin/events?saved=1");
  }

  return (
    <div className="px-4 py-6 space-y-6">
      <h1 className="text-2xl font-display font-bold text-navy">Events</h1>

      <form action={addEvent} className="rounded-xl border border-hairline bg-parchment p-4 space-y-3">
        <p className="font-semibold text-navy text-sm">New Event</p>
        {searchParams.error && (
          <p className="rounded-lg bg-usa-red/10 px-3 py-2 text-sm text-usa-red">{searchParams.error}</p>
        )}
        <input name="year"       required placeholder="Year (e.g. 2026)" type="number" className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="name"       required placeholder="Event name"                     className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="location"            placeholder="Location"                       className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="start_date"          placeholder="Start date" type="date"         className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <input name="end_date"            placeholder="End date"   type="date"         className="w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy" />
        <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
          Create Event
        </button>
      </form>

      <EventList events={events ?? []} />
    </div>
  );
}
