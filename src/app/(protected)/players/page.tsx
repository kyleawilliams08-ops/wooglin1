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

  return (
    <div className="px-4 py-6 space-y-4">
      <h1 className="text-2xl font-display font-bold text-navy">Players</h1>
      <ul className="space-y-2">
        {players?.map((p) => (
          <li key={p.id}>
            <Link
              href={`/players/${p.id}`}
              className="flex items-center justify-between rounded-xl border border-hairline bg-white px-4 py-3 hover:bg-parchment transition-colors"
            >
              <div>
                <p className="font-semibold text-navy">
                  {p.name}
                  {p.nickname && p.nickname !== p.name && (
                    <span className="text-navy/40 font-normal"> · {p.nickname}</span>
                  )}
                </p>
                <p className="text-xs text-navy/50 uppercase">{p.role}</p>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-sm text-navy tabular-nums">{p.current_index ?? "—"}</p>
                <span className="text-navy/30">›</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
