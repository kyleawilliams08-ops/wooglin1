import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { InstallPrompt } from "@/components/InstallPrompt";
import { LiveRefresher } from "@/components/LiveRefresher";
import { FeedList, type FeedItem } from "@/components/FeedList";
import { FeedFilter } from "@/components/FeedFilter";
import { ledgerNets, fmtNet } from "@/lib/bets";

// One quip per page load — clubhouse locker-room energy, kept clean.
const QUIPS = [
  "Drive for show, putt for dough.",
  "Play well. Or at least dress well.",
  "The most important shot in golf is the next one.",
  "Never up, never in.",
  "Beware the sandbagger with a fresh handicap.",
  "It's not a gimme if you're still away.",
  "Half strokes count double in the group chat.",
  "The dragon guards the flag.",
];

const VALID_KINDS = ["hole", "match_final", "standings", "lineup", "bet"];

export default async function Home({
  searchParams,
}: {
  searchParams: { kinds?: string };
}) {
  const player = await requirePlayer();
  const kinds = (searchParams.kinds ?? "").split(",").filter((k) => VALID_KINDS.includes(k));
  const supabase = createClient();

  const { data: activeEvents } = await supabase
    .from("events")
    .select("*")
    .eq("status", "active")
    .order("year", { ascending: false })
    .limit(1);
  const activeEvent = activeEvents?.[0] ?? null;

  // Clubhouse feed for the active event (written by scoring/lineup actions)
  let feedQuery = activeEvent
    ? supabase
        .from("feed_events")
        .select("id, kind, message, created_at, matchup_id")
        .eq("event_id", activeEvent.id)
        .order("created_at", { ascending: false })
        .limit(10)
    : null;
  if (feedQuery && kinds.length > 0) feedQuery = feedQuery.in("kind", kinds);
  const { data: feed } = feedQuery ? await feedQuery : { data: [] };

  // This year's bets: net for the card + your open/protested ones up top
  const { data: yearBetsRaw } = await supabase
    .from("bets")
    .select("id, status, amount, description, bet_type, bet_participants(player_id, is_winner, players(nickname, name))")
    .eq("year", new Date().getFullYear())
    .in("status", ["pending", "active", "closed", "protested"]);
  const yearBets = ((yearBetsRaw ?? []) as unknown as {
    id: string; status: string; amount: number; description: string | null; bet_type: string;
    bet_participants: { player_id: string; is_winner: boolean | null; players: { nickname: string | null; name: string } | null }[];
  }[]).map((b) => ({ ...b, amount: Number(b.amount) }));
  const myBetNet = ledgerNets(yearBets).get(player.id) ?? 0;
  const myOpenBets = yearBets
    .filter((b) =>
      (b.status === "active" || b.status === "pending" || b.status === "protested") &&
      b.bet_participants.some((p) => p.player_id === player.id))
    .sort((a, b) => (a.status === "protested" ? 0 : 1) - (b.status === "protested" ? 0 : 1));

  const { data: results } = await supabase
    .from("event_results")
    .select("year, winner, location, captains, final_score")
    .order("year", { ascending: false });
  const reigning = results?.[0] ?? null;
  const usaCups = results?.filter((r) => r.winner.toLowerCase().includes("usa")).length ?? 0;
  const eurCups = results?.filter((r) => r.winner.toLowerCase().includes("eur")).length ?? 0;

  const quip = QUIPS[Math.floor(Math.random() * QUIPS.length)];

  async function signOut() {
    "use server";
    const supabase = createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  return (
    <div className="px-4 py-6 space-y-5">
      <LiveRefresher />
      {/* Masthead greeting */}
      <div className="flex items-center gap-4">
        <Image src="/crest-small.png" alt="Wooglin Cup crest" width={64} height={64} priority
          className="shrink-0" />
        <div>
          <h1 className="text-2xl font-display font-bold text-navy leading-tight">
            Welcome back, {player.nickname ?? player.name}
          </h1>
          <p className="text-sm text-navy/50 italic mt-0.5">&ldquo;{quip}&rdquo;</p>
        </div>
      </div>

      <InstallPrompt />

      {/* Active event hero */}
      {activeEvent ? (
        <Link href="/matches" className="block rounded-2xl bg-navy p-5 relative overflow-hidden">
          <span className="absolute top-4 right-4 text-[10px] font-bold tracking-widest uppercase text-navy bg-gold rounded-full px-2.5 py-1">
            Live
          </span>
          <p className="text-xs text-hairline/60 uppercase tracking-widest mb-1">Active Event</p>
          <p className="text-xl font-display font-bold text-off-white">{activeEvent.name}</p>
          <p className="text-sm text-hairline mt-1">
            {activeEvent.location}{activeEvent.location ? " · " : ""}{activeEvent.year}
          </p>
          <p className="mt-4 text-sm font-semibold text-gold">Matches &amp; live scoring →</p>
        </Link>
      ) : (
        <div className="rounded-2xl bg-navy p-5">
          <p className="text-sm text-hairline">No active event — the off-season is for practicing your excuses.</p>
        </div>
      )}

      {/* Your open bets — the ones that need closing out */}
      {myOpenBets.length > 0 && (
        <Link href="/bets" className="block rounded-2xl border border-gold/60 bg-parchment">
          <p className="border-b border-gold/30 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-navy/60">
            💰 Your open bets ({myOpenBets.length})
          </p>
          <ul className="divide-y divide-gold/20">
            {myOpenBets.slice(0, 4).map((b) => {
              const others = b.bet_participants
                .filter((p) => p.player_id !== player.id)
                .map((p) => p.players?.nickname ?? p.players?.name ?? "?")
                .join(" / ");
              return (
                <li key={b.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-navy">
                      {b.description || (b.bet_type === "group" ? "Group bet" : b.bet_type === "teams" ? "2 v 2" : "1 on 1")}
                    </p>
                    <p className="truncate text-xs text-navy/50">w/ {others}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-bold tabular-nums text-navy">${Number(b.amount)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                      b.status === "protested" ? "bg-usa-red text-white" : "bg-navy/10 text-navy/60"
                    }`}>
                      {b.status === "protested" ? "Protested" : "Open"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-gold/30 px-4 py-2 text-center text-xs font-semibold text-navy/50">
            Tap to close out →
          </p>
        </Link>
      )}

      {/* Clubhouse feed — live play-by-play from the course (latest 10) */}
      {activeEvent && ((feed?.length ?? 0) > 0 || kinds.length > 0) && (
        <div className="rounded-2xl border border-hairline bg-white">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-navy/50">
              Clubhouse Feed
            </p>
            <span className="flex items-center gap-3">
              {kinds.length > 0 && (
                <Link href="/" className="text-[11px] font-semibold text-navy/50 underline underline-offset-2">
                  Clear filters
                </Link>
              )}
              <FeedFilter />
            </span>
          </div>
          {(feed?.length ?? 0) === 0 ? (
            <p className="px-4 py-3 text-sm text-navy/50">No updates match these filters.</p>
          ) : (
            <FeedList items={(feed ?? []) as FeedItem[]} />
          )}
          <Link href="/feed"
            className="block border-t border-hairline px-4 py-2.5 text-center text-xs font-semibold text-navy/50 hover:text-navy">
            View full feed →
          </Link>
        </div>
      )}

      {/* All-time series */}
      {(usaCups > 0 || eurCups > 0) && (
        <div className="rounded-2xl border border-hairline bg-white p-4">
          <p className="text-xs font-semibold text-navy/50 uppercase tracking-wide text-center mb-3">
            All-Time Series
          </p>
          <div className="grid grid-cols-3 items-center text-center">
            <div>
              <p className="text-3xl font-bold tabular-nums text-usa-red">{usaCups}</p>
              <p className="text-xs font-semibold text-usa-red/70 mt-0.5">USA</p>
            </div>
            <p className="text-navy/30 text-sm">·</p>
            <div>
              <p className="text-3xl font-bold tabular-nums text-europe-green">{eurCups}</p>
              <p className="text-xs font-semibold text-europe-green/70 mt-0.5">Europe</p>
            </div>
          </div>
        </div>
      )}

      {/* Reigning champions */}
      {reigning && (
        <Link href="/history" className="block rounded-2xl border border-gold/50 bg-parchment p-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🏆</span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-gold uppercase tracking-wide">Reigning Champions</p>
              <p className="text-sm font-bold text-navy mt-0.5">
                {reigning.year} · {reigning.winner}
                {reigning.final_score ? ` (${reigning.final_score})` : ""}
              </p>
              <p className="text-xs text-navy/50 truncate">
                {[reigning.captains, reigning.location].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
        </Link>
      )}

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/players" className="rounded-xl border border-hairline bg-white px-4 py-3 hover:bg-parchment transition-colors">
          <p className="font-semibold text-navy text-sm">Player Cards</p>
          <p className="text-xs text-navy/50 mt-0.5">Profiles &amp; records</p>
        </Link>
        <Link href="/history" className="rounded-xl border border-hairline bg-white px-4 py-3 hover:bg-parchment transition-colors">
          <p className="font-semibold text-navy text-sm">History</p>
          <p className="text-xs text-navy/50 mt-0.5">Past cups</p>
        </Link>
        <Link href="/bets" className="rounded-xl border border-hairline bg-white px-4 py-3 hover:bg-parchment transition-colors col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-navy text-sm">Betting</p>
              <p className="text-xs text-navy/50 mt-0.5">Side bets &amp; the ledger</p>
            </div>
            {myBetNet !== 0 && (
              <p className={`text-lg font-bold tabular-nums ${myBetNet > 0 ? "text-europe-green" : "text-usa-red"}`}>
                {fmtNet(myBetNet)}
              </p>
            )}
          </div>
        </Link>
        {isAdmin(player) && (
          <Link href="/menu" className="rounded-xl border border-hairline bg-white px-4 py-3 hover:bg-parchment transition-colors col-span-2">
            <p className="font-semibold text-navy text-sm">Commissioner Tools</p>
            <p className="text-xs text-navy/50 mt-0.5">Events, rosters, courses &amp; setup</p>
          </Link>
        )}
      </div>

      <form action={signOut}>
        <button
          type="submit"
          className="text-sm text-navy/40 hover:text-navy transition-colors"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
