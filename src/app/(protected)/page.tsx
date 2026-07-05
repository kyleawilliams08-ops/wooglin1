import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { InstallPrompt } from "@/components/InstallPrompt";
import { LiveRefresher } from "@/components/LiveRefresher";

// One quip per page load — clubhouse locker-room energy, kept clean.
const FEED_ICONS: Record<string, string> = {
  hole: "⛳",
  match_final: "🏆",
  standings: "📊",
  lineup: "📋",
};

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

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

export default async function Home() {
  const player = await requirePlayer();
  const supabase = createClient();

  const { data: activeEvents } = await supabase
    .from("events")
    .select("*")
    .eq("status", "active")
    .order("year", { ascending: false })
    .limit(1);
  const activeEvent = activeEvents?.[0] ?? null;

  // Clubhouse feed for the active event (written by scoring/lineup actions)
  const { data: feed } = activeEvent
    ? await supabase
        .from("feed_events")
        .select("id, kind, message, created_at")
        .eq("event_id", activeEvent.id)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [] };

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
        <Link href="/live" className="block rounded-2xl bg-navy p-5 relative overflow-hidden">
          <span className="absolute top-4 right-4 text-[10px] font-bold tracking-widest uppercase text-navy bg-gold rounded-full px-2.5 py-1">
            Live
          </span>
          <p className="text-xs text-hairline/60 uppercase tracking-widest mb-1">Active Event</p>
          <p className="text-xl font-display font-bold text-off-white">{activeEvent.name}</p>
          <p className="text-sm text-hairline mt-1">
            {activeEvent.location}{activeEvent.location ? " · " : ""}{activeEvent.year}
          </p>
          <p className="mt-4 text-sm font-semibold text-gold">Open the Live Scoreboard →</p>
        </Link>
      ) : (
        <div className="rounded-2xl bg-navy p-5">
          <p className="text-sm text-hairline">No active event — the off-season is for practicing your excuses.</p>
        </div>
      )}

      {/* Clubhouse feed — live play-by-play from the course */}
      {activeEvent && (feed?.length ?? 0) > 0 && (
        <div className="rounded-2xl border border-hairline bg-white">
          <p className="border-b border-hairline px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-navy/50">
            Clubhouse Feed
          </p>
          <ul className="divide-y divide-hairline">
            {feed!.map((f) => (
              <li key={f.id} className="flex items-start gap-2.5 px-4 py-2.5">
                <span className="text-base leading-snug">{FEED_ICONS[f.kind] ?? "📣"}</span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm leading-snug text-navy ${f.kind === "match_final" || f.kind === "standings" ? "font-semibold" : ""}`}>
                    {f.message}
                  </p>
                  <p className="mt-0.5 text-[11px] text-navy/40">{timeAgo(f.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
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
