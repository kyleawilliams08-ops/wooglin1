import Link from "next/link";

export interface FeedItem {
  id: string;
  kind: string;
  message: string;
  created_at: string;
  matchup_id: string | null;
}

const ICONS: Record<string, string> = {
  hole: "⛳",
  match_final: "🏆",
  standings: "📊",
  lineup: "📋",
  bet: "💰",
};

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Where tapping an entry takes you. */
function hrefFor(f: FeedItem): string {
  if (f.kind === "bet") return "/bets";
  if (f.kind === "standings" || !f.matchup_id) return "/matches";
  if (f.kind === "match_final") return `/live/match/${f.matchup_id}?view=card`;
  return `/live/match/${f.matchup_id}`;
}

export function FeedList({ items }: { items: FeedItem[] }) {
  return (
    <ul className="divide-y divide-hairline">
      {items.map((f) => (
        <li key={f.id}>
          <Link
            href={hrefFor(f)}
            className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-parchment transition-colors"
          >
            <span className="text-base leading-snug">{ICONS[f.kind] ?? "📣"}</span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm leading-snug text-navy ${f.kind === "match_final" || f.kind === "standings" ? "font-semibold" : ""}`}>
                {f.message}
              </p>
              <p className="mt-0.5 text-[11px] text-navy/40">{timeAgo(f.created_at)}</p>
            </div>
            <span className="self-center text-navy/25">›</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
