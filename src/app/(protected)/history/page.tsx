import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

// Winner chip colors keyed loosely on the team name so free-text backfill works.
function winnerStyle(winner: string): { bg: string; label: string } {
  const w = winner.toLowerCase();
  if (w.includes("usa")) return { bg: "#BE2F27", label: winner };
  if (w.includes("eur")) return { bg: "#185D3B", label: winner };
  return { bg: "#0C2D55", label: winner };
}

export default async function HistoryPage() {
  const player = await requirePlayer();
  const supabase = createClient();

  const { data: results } = await supabase
    .from("event_results")
    .select("*")
    .order("year", { ascending: false });

  return (
    <div className="px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-navy">History</h1>
        {isAdmin(player) && (
          <Link href="/admin/history" className="text-sm text-navy/50 underline underline-offset-2">
            Edit
          </Link>
        )}
      </div>

      {(!results || results.length === 0) && (
        <p className="text-sm text-navy/50">
          No past cups recorded yet{isAdmin(player) ? " — add them under Admin → History." : "."}
        </p>
      )}

      <ul className="space-y-2">
        {results?.map((r) => {
          const w = winnerStyle(r.winner);
          const hasDetail = r.captains || r.roster || r.notes;
          return (
            <li key={r.id} className="rounded-xl border border-hairline bg-white">
              <details className="group">
                <summary className={`flex items-center justify-between gap-3 px-4 py-3 list-none [&::-webkit-details-marker]:hidden ${hasDetail ? "cursor-pointer" : "pointer-events-none"}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-lg font-display font-bold text-navy tabular-nums">{r.year}</span>
                    <div className="min-w-0">
                      <p className="text-sm text-navy truncate">
                        {r.final_score && <span className="font-semibold tabular-nums">{r.final_score}</span>}
                        {r.location && <span className="text-navy/50">{r.final_score ? " · " : ""}{r.location}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-white" style={{ backgroundColor: w.bg }}>
                      {w.label}
                    </span>
                    {hasDetail && <span className="text-navy/30 transition-transform group-open:rotate-90">›</span>}
                  </div>
                </summary>
                {hasDetail && (
                  <div className="px-4 pb-3 pt-1 border-t border-hairline text-sm text-navy/70 space-y-1.5">
                    {r.captains && <p><span className="text-navy/40 text-xs uppercase tracking-wide">Captains</span><br />{r.captains}</p>}
                    {r.roster && <p className="whitespace-pre-line"><span className="text-navy/40 text-xs uppercase tracking-wide">Roster</span><br />{r.roster}</p>}
                    {r.notes && <p className="whitespace-pre-line"><span className="text-navy/40 text-xs uppercase tracking-wide">Notes</span><br />{r.notes}</p>}
                  </div>
                )}
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
