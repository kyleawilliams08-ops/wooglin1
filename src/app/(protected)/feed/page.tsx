import { requirePlayer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { LiveRefresher } from "@/components/LiveRefresher";
import { FeedList, type FeedItem } from "@/components/FeedList";
import { FeedFilter } from "@/components/FeedFilter";

const VALID_KINDS = ["hole", "match_final", "standings", "lineup", "bet"];

// Full clubhouse feed for the active event (Home shows the latest 10).
export default async function FeedPage({
  searchParams,
}: {
  searchParams: { kinds?: string };
}) {
  await requirePlayer();
  const supabase = createClient();
  const kinds = (searchParams.kinds ?? "").split(",").filter((k) => VALID_KINDS.includes(k));

  const { data: events } = await supabase
    .from("events")
    .select("id, name, year")
    .eq("status", "active")
    .order("year", { ascending: false })
    .limit(1);
  const event = events?.[0];

  let feedQuery = event
    ? supabase
        .from("feed_events")
        .select("id, kind, message, created_at, matchup_id")
        .eq("event_id", event.id)
        .order("created_at", { ascending: false })
        .limit(100)
    : null;
  if (feedQuery && kinds.length > 0) feedQuery = feedQuery.in("kind", kinds);
  const { data: feed } = feedQuery ? await feedQuery : { data: [] };

  return (
    <div className="px-4 py-6 space-y-4">
      <LiveRefresher />
      <Link href="/" className="text-sm text-navy/50 hover:text-navy">← Home</Link>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy">Clubhouse Feed</h1>
          {event && <p className="text-sm text-navy/50 mt-0.5">{event.name} · {event.year}</p>}
        </div>
        <span className="flex items-center gap-3 pb-1">
          {kinds.length > 0 && (
            <Link href="/feed" className="text-[11px] font-semibold text-navy/50 underline underline-offset-2">
              Clear filters
            </Link>
          )}
          <FeedFilter />
        </span>
      </div>

      {!event ? (
        <p className="text-sm text-navy/50">No active event.</p>
      ) : (feed?.length ?? 0) === 0 ? (
        <p className="text-sm text-navy/50">
          {kinds.length > 0 ? "No updates match these filters." : "Nothing yet — updates appear here as matches are played."}
        </p>
      ) : (
        <div className="rounded-2xl border border-hairline bg-white">
          <FeedList items={(feed ?? []) as FeedItem[]} />
        </div>
      )}
    </div>
  );
}
