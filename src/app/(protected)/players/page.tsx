import { requirePlayer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function PlayersPage() {
  await requirePlayer();
  const supabase = createClient();
  const { data: players } = await supabase
    .from("players")
    .select("*")
    .order("name");

  // Aggregate cup history for the summary line on each row
  const { data: apps } = await supabase
    .from("player_appearances")
    .select("player_id, result");
  const summary = new Map<string, { n: number; w: number; l: number; t: number }>();
  for (const a of apps ?? []) {
    const s = summary.get(a.player_id) ?? { n: 0, w: 0, l: 0, t: 0 };
    s.n++;
    if (a.result === "W") s.w++;
    else if (a.result === "L") s.l++;
    else s.t++;
    summary.set(a.player_id, s);
  }

  const initials = (p: { name: string; nickname: string | null }) =>
    (p.nickname ?? p.name).split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="px-4 py-6 space-y-4">
      <h1 className="text-2xl font-display font-bold text-navy">Player Cards</h1>
      <ul className="space-y-2">
        {players?.map((p) => {
          const s = summary.get(p.id);
          return (
            <li key={p.id}>
              <Link
                href={`/players/${p.id}`}
                className="flex items-center gap-3 rounded-xl border border-hairline bg-white px-4 py-3 hover:bg-parchment transition-colors"
              >
                {p.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.avatar_url} alt={p.name}
                    className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-gold/60" />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy font-display text-sm font-bold text-off-white ring-1 ring-gold/60">
                    {initials(p)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-navy">
                    {p.nickname ?? p.name}
                    {p.nickname && p.nickname !== p.name && (
                      <span className="font-normal text-navy/40"> · {p.name}</span>
                    )}
                  </p>
                  <p className="text-xs text-navy/50">
                    {s
                      ? `${s.n} cup${s.n === 1 ? "" : "s"} · ${s.w}–${s.l}${s.t > 0 ? `–${s.t}` : ""}`
                      : "Rookie — no cups yet"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <p className="text-sm text-navy tabular-nums">{p.current_index ?? "—"}</p>
                  <span className="text-navy/30">›</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
