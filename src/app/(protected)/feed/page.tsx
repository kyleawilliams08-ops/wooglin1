import { requirePlayer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { LiveRefresher } from "@/components/LiveRefresher";
import { FeedList, type FeedItem } from "@/components/FeedList";

// Full clubhouse feed for the active event (Home shows the latest 10).
export default async function FeedPage() {
  await requirePlayer();
  const supabase = createClient();

  const { data: events } = await supabase
    .from("events")
    .select("id, name, year")
    .eq("status", "active")
    .order("year", { ascending: false })
    .limit(1);
  const event = events?.[0];

  const { data: feed } = event
    ? await supabase
        .from("feed_events")
        .select("id, kind, message, created_at, matchup_id")
        .eq("event_id", event.id)
        .order("created_at", { ascending: false })
        .limit(100)
    : { data: [] };

  return (
    <div className="px-4 py-6 space-y-4">
      <LiveRefresher />
      <Link href="/" className="text-sm text-navy/50 hover:text-navy">← Home</Link>
      <div>
        <h1 className="text-2xl font-display font-bold text-navy">Clubhouse Feed</h1>
        {event && <p className="text-sm text-navy/50 mt-0.5">{event.name} · {event.year}</p>}
      </div>

      {!event ? (
        <p className="text-sm text-navy/50">No active event.</p>
      ) : (feed?.length ?? 0) === 0 ? (
        <p className="text-sm text-navy/50">Nothing yet — updates appear here as matches are played.</p>
      ) : (
        <div className="rounded-2xl border border-hairline bg-white">
          <FeedList items={(feed ?? []) as FeedItem[]} />
        </div>
      )}
    </div>
  );
}
