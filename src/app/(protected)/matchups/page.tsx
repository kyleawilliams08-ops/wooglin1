import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

type EPRef = { display_name: string } | null;

function fmtTeeTime(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, "0")} ${ampm}`;
}

// The pairings sheet for the active cup: who plays whom, when, in what format.
// Admins get manage links into the matchup builder.
export default async function MatchupsPage() {
  const player = await requirePlayer();
  const admin = isAdmin(player);
  const supabase = createClient();

  const { data: events } = await supabase
    .from("events")
    .select("id, name, year")
    .eq("status", "active")
    .order("year", { ascending: false })
    .limit(1);
  const event = events?.[0];

  if (!event) {
    return (
      <div className="px-4 py-6">
        <h1 className="text-2xl font-display font-bold text-navy">Matchups</h1>
        <p className="mt-2 text-sm text-navy/50">
          No active event.{admin ? " Activate one under Menu → Events." : ""}
        </p>
      </div>
    );
  }

  const { data: teams } = await supabase
    .from("teams").select("id, name, color").eq("event_id", event.id).order("name");
  const homeTeam = teams?.[0];
  const awayTeam = teams?.[1];

  // Captains of this event can edit their team's lineups
  const { data: captainEp } = await supabase
    .from("event_participants")
    .select("team_id")
    .eq("event_id", event.id)
    .eq("player_id", player.id)
    .eq("is_captain", true)
    .maybeSingle();
  const canEditLineups = admin || captainEp != null;

  const { data: roundsRaw } = await supabase
    .from("rounds")
    .select("id, round_number, name, side, played_at, formats(name), course_tees(tee_name, courses(name))")
    .eq("event_id", event.id)
    .order("round_number");
  const rounds = (roundsRaw ?? []) as unknown as {
    id: string; round_number: number; name: string | null; side: string; played_at: string | null;
    formats: { name: string } | null;
    course_tees: { tee_name: string; courses: { name: string } | null } | null;
  }[];

  const { data: matchupsRaw } = rounds.length > 0
    ? await supabase
        .from("matchups")
        .select(`
          id, round_id, match_number, status, result, match_score, tee_time,
          home_p1:event_participants!matchups_home_p1_id_fkey(display_name),
          home_p2:event_participants!matchups_home_p2_id_fkey(display_name),
          away_p1:event_participants!matchups_away_p1_id_fkey(display_name),
          away_p2:event_participants!matchups_away_p2_id_fkey(display_name)
        `)
        .in("round_id", rounds.map((r) => r.id))
        .order("match_number")
    : { data: [] };
  const matchups = (matchupsRaw ?? []) as unknown as {
    id: string; round_id: string; match_number: number; status: string;
    result: string | null; match_score: string | null; tee_time: string | null;
    home_p1: EPRef; home_p2: EPRef; away_p1: EPRef; away_p2: EPRef;
  }[];

  const names = (a: EPRef, b: EPRef) =>
    [a?.display_name, b?.display_name].filter(Boolean).join(" / ") || "TBD";

  const sideLabel: Record<string, string> = { front: "Front 9", back: "Back 9", full: "Full 18" };

  return (
    <div className="px-4 py-6 space-y-5">
      <div>
        <h1 className="text-2xl font-display font-bold text-navy">Matchups</h1>
        <p className="text-sm text-navy/50 mt-0.5">{event.name} · {event.year}</p>
      </div>

      {rounds.length === 0 && (
        <p className="text-sm text-navy/50">
          No rounds yet.{admin ? " Set them up under Menu → Events." : " Check back once the schedule drops."}
        </p>
      )}

      {rounds.map((round) => {
        const ms = matchups.filter((m) => m.round_id === round.id);
        return (
          <div key={round.id}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-navy/50 uppercase tracking-wide">
                R{round.round_number}{round.name ? ` · ${round.name}` : ""} — {round.course_tees?.courses?.name} · {sideLabel[round.side]} · {round.formats?.name}
              </p>
              {admin && (
                <Link
                  href={`/admin/events/${event.id}/rounds/${round.id}/matchups`}
                  className="text-xs text-navy/50 underline underline-offset-2 shrink-0"
                >
                  Manage
                </Link>
              )}
            </div>

            {ms.length === 0 ? (
              <p className="mb-2 text-xs text-navy/40">
                Pairings not set yet.{admin ? " Use Manage to build them." : ""}
              </p>
            ) : (
              <ul className="space-y-2">
                {ms.map((m) => (
                  <li key={m.id} className="flex items-stretch gap-2">
                    <Link
                      href={`/live/match/${m.id}`}
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl border border-hairline bg-white px-4 py-3 hover:bg-parchment transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-navy truncate">
                          <span style={{ color: homeTeam?.color ?? undefined }}>{names(m.home_p1, m.home_p2)}</span>
                          <span className="text-navy/40 font-normal"> vs </span>
                          <span style={{ color: awayTeam?.color ?? undefined }}>{names(m.away_p1, m.away_p2)}</span>
                        </p>
                        <p className="text-xs text-navy/40 mt-0.5">
                          Match {m.match_number}
                          {fmtTeeTime(m.tee_time) ? ` · ${fmtTeeTime(m.tee_time)}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-navy/50">
                        {m.status === "complete" && m.match_score ? m.match_score : "›"}
                      </span>
                    </Link>
                    {canEditLineups && (
                      <Link
                        href={`/admin/events/${event.id}/rounds/${round.id}/matchups/${m.id}`}
                        className="flex shrink-0 items-center rounded-xl border border-hairline bg-parchment px-3 text-xs font-semibold text-navy/60 hover:text-navy"
                      >
                        Edit
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
