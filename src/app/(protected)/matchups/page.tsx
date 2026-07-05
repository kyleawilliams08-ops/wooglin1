import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { recordLineup } from "@/lib/feed";

type EPRef = { id: string; display_name: string } | null;

function fmtTeeTime(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, "0")} ${ampm}`;
}

function dayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// The pairings sheet, organized by day. Admins build the shells (rounds,
// matchups, tee times); captains fill in their team's players right here.
export default async function MatchupsPage({
  searchParams,
}: {
  searchParams: { day?: string };
}) {
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
  const eventId = event.id;

  const { data: teams } = await supabase
    .from("teams").select("id, name, color").eq("event_id", eventId).order("name");
  const homeTeam = teams?.[0];
  const awayTeam = teams?.[1];

  // Captains fill lineups for their own team
  const { data: captainEp } = await supabase
    .from("event_participants")
    .select("team_id")
    .eq("event_id", eventId)
    .eq("player_id", player.id)
    .eq("is_captain", true)
    .maybeSingle();
  const canEditHome = admin || (captainEp != null && captainEp.team_id === homeTeam?.id);
  const canEditAway = admin || (captainEp != null && captainEp.team_id === awayTeam?.id);

  const { data: roundsRaw } = await supabase
    .from("rounds")
    .select("id, round_number, name, side, played_at, formats(name), course_tees(tee_name, courses(name))")
    .eq("event_id", eventId)
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
          home_p1_id, home_p2_id, away_p1_id, away_p2_id,
          home_p1:event_participants!matchups_home_p1_id_fkey(id, display_name),
          home_p2:event_participants!matchups_home_p2_id_fkey(id, display_name),
          away_p1:event_participants!matchups_away_p1_id_fkey(id, display_name),
          away_p2:event_participants!matchups_away_p2_id_fkey(id, display_name)
        `)
        .in("round_id", rounds.map((r) => r.id))
        .order("match_number")
    : { data: [] };
  const matchups = (matchupsRaw ?? []) as unknown as {
    id: string; round_id: string; match_number: number; status: string;
    result: string | null; match_score: string | null; tee_time: string | null;
    home_p1_id: string | null; home_p2_id: string | null;
    away_p1_id: string | null; away_p2_id: string | null;
    home_p1: EPRef; home_p2: EPRef; away_p1: EPRef; away_p2: EPRef;
  }[];

  // Matches with any entered score lock their lineups (admins can still
  // override via the Edit page)
  const matchupIds = matchups.map((m) => m.id);
  const { data: scoreRows } = matchupIds.length > 0
    ? await supabase
        .from("hole_scores")
        .select("matchup_id, home_p1_gross, home_p2_gross, away_p1_gross, away_p2_gross")
        .in("matchup_id", matchupIds)
    : { data: [] };
  const underway = new Set(
    (scoreRows ?? [])
      .filter((r) => r.home_p1_gross != null || r.home_p2_gross != null || r.away_p1_gross != null || r.away_p2_gross != null)
      .map((r) => r.matchup_id),
  );

  // Team rosters for the lineup selects
  const { data: participants } = await supabase
    .from("event_participants")
    .select("id, display_name, team_id")
    .eq("event_id", eventId)
    .order("display_name");
  const rosterFor = (teamId: string | undefined) =>
    (participants ?? []).filter((p) => p.team_id === teamId);

  // ── Day grouping (played_at date, falling back to the round itself) ──────
  type Day = { key: string; label: string; rounds: typeof rounds };
  const days: Day[] = [];
  for (const r of rounds) {
    const key = r.played_at ?? `round-${r.id}`;
    const label = r.played_at ? dayLabel(r.played_at) : (r.name ?? `Round ${r.round_number}`);
    const existing = days.find((d) => d.key === key);
    if (existing) existing.rounds.push(r);
    else days.push({ key, label, rounds: [r] });
  }
  const selectedDay = days.find((d) => d.key === searchParams.day) ?? days[0];

  // ── Server action: captains/admins set a side's lineup ──────────────────
  async function setLineup(formData: FormData) {
    "use server";
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    const matchupId = formData.get("matchup_id") as string;
    const side = formData.get("side") as "home" | "away";

    // Re-derive authorization server-side
    const { data: me } = await supabase
      .from("players").select("id, role").eq("auth_user_id", user.id).single();
    if (!me) redirect("/login");
    const meAdmin = me.role === "admin" || me.role === "assistant";
    if (!meAdmin) {
      const { data: cap } = await supabase
        .from("event_participants")
        .select("team_id")
        .eq("event_id", eventId)
        .eq("player_id", me.id)
        .eq("is_captain", true)
        .maybeSingle();
      const sideTeamId = side === "home" ? homeTeam?.id : awayTeam?.id;
      if (!cap || cap.team_id !== sideTeamId) throw new Error("Not your lineup to set");

      // Captains can't swap players once the match is underway
      const { data: existing } = await supabase
        .from("hole_scores")
        .select("home_p1_gross, home_p2_gross, away_p1_gross, away_p2_gross")
        .eq("matchup_id", matchupId);
      const hasScores = (existing ?? []).some(
        (r) => r.home_p1_gross != null || r.home_p2_gross != null || r.away_p1_gross != null || r.away_p2_gross != null,
      );
      if (hasScores) throw new Error("Lineup is locked — this match is underway");
    }

    const p1 = (formData.get("p1") as string) || null;
    let p2 = (formData.get("p2") as string) || null;

    // Singles has one ball per side; and a player can't partner themselves.
    const { data: mrow } = await supabase
      .from("matchups")
      .select("rounds(formats(name))")
      .eq("id", matchupId)
      .single();
    const fmtName = (mrow as unknown as { rounds: { formats: { name: string } | null } | null } | null)
      ?.rounds?.formats?.name;
    if (fmtName === "Singles" || (p2 !== null && p2 === p1)) p2 = null;

    const update = side === "home"
      ? { home_p1_id: p1, home_p2_id: p2 }
      : { away_p1_id: p1, away_p2_id: p2 };
    const { error } = await supabase.from("matchups").update(update).eq("id", matchupId);
    // Surface failures (e.g. missing RLS policy) instead of silently "saving"
    if (error) throw new Error(`Couldn't save lineup: ${error.message}`);
    await recordLineup(supabase, matchupId, side); // best-effort feed entry
    revalidatePath("/matchups");
  }

  const selectCls = "w-full rounded-lg border border-hairline bg-white px-2 py-1.5 text-sm text-navy";

  return (
    <div className="px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-display font-bold text-navy">Matchups</h1>
        <p className="text-sm text-navy/50 mt-0.5">{event.name} · {event.year}</p>
      </div>

      {days.length === 0 && (
        <p className="text-sm text-navy/50">
          No rounds yet.{admin ? " Set them up under Menu → Events." : " Check back once the schedule drops."}
        </p>
      )}

      {/* Day tabs */}
      {days.length > 1 && (
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
          {days.map((d) => (
            <Link
              key={d.key}
              href={`/matchups?day=${encodeURIComponent(d.key)}`}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold border transition-colors ${
                d.key === selectedDay?.key
                  ? "bg-navy text-off-white border-navy"
                  : "bg-white text-navy/60 border-hairline"
              }`}
            >
              {d.label}
            </Link>
          ))}
        </div>
      )}

      {selectedDay?.rounds.map((round) => {
        const ms = matchups.filter((m) => m.round_id === round.id);
        const sideLabel: Record<string, string> = { front: "Front 9", back: "Back 9", full: "Full 18" };
        const isSingles = round.formats?.name === "Singles";

        // Participants already placed in OTHER matchups of this round
        const usedElsewhere = (excludeId: string) => {
          const used = new Set<string>();
          for (const m of ms) {
            if (m.id === excludeId) continue;
            for (const id of [m.home_p1_id, m.home_p2_id, m.away_p1_id, m.away_p2_id]) {
              if (id) used.add(id);
            }
          }
          return used;
        };

        return (
          <div key={round.id} className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-navy/50 uppercase tracking-wide">
                R{round.round_number}{round.name ? ` · ${round.name}` : ""} — {round.course_tees?.courses?.name} · {sideLabel[round.side]} · {round.formats?.name}
              </p>
              {admin && (
                <Link
                  href={`/admin/events/${eventId}/rounds/${round.id}/matchups`}
                  className="text-xs text-navy/50 underline underline-offset-2 shrink-0"
                >
                  Manage
                </Link>
              )}
            </div>

            {ms.length === 0 ? (
              <p className="text-xs text-navy/40">
                Pairings not set yet.{admin ? " Use Manage to create the matches." : ""}
              </p>
            ) : (
              ms.map((m) => {
                const used = usedElsewhere(m.id);
                const complete = m.status === "complete";
                const locked = complete || underway.has(m.id);

                const sideBlock = (
                  side: "home" | "away",
                  team: typeof homeTeam,
                  p1: EPRef, p2: EPRef,
                  editable: boolean,
                ) => {
                  const roster = rosterFor(team?.id).filter(
                    (p) => !used.has(p.id) || p.id === p1?.id || p.id === p2?.id,
                  );
                  const showForm = editable && !locked;
                  return (
                    <div className="flex-1 min-w-0 rounded-lg p-2.5" style={{ backgroundColor: `${team?.color ?? "#0C2D55"}12` }}>
                      <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: team?.color ?? "#0C2D55" }}>
                        {team?.name ?? side}
                      </p>
                      {showForm ? (
                        <form action={setLineup} className="space-y-1.5">
                          <input type="hidden" name="matchup_id" value={m.id} />
                          <input type="hidden" name="side" value={side} />
                          <select name="p1" defaultValue={p1?.id ?? ""} className={selectCls}>
                            <option value="">{isSingles ? "Player…" : "Player 1…"}</option>
                            {roster.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                          </select>
                          {!isSingles && (
                            <select name="p2" defaultValue={p2?.id ?? ""} className={selectCls}>
                              <option value="">Player 2 (blank for 2v1)</option>
                              {roster.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                            </select>
                          )}
                          <button type="submit"
                            className="w-full rounded-lg py-1.5 text-xs font-semibold text-white"
                            style={{ backgroundColor: team?.color ?? "#0C2D55" }}>
                            Save lineup
                          </button>
                        </form>
                      ) : (
                        <p className="text-base font-semibold text-navy leading-snug">
                          {[p1?.display_name, p2?.display_name].filter(Boolean).join(" / ") || <span className="text-navy/30">TBD</span>}
                        </p>
                      )}
                    </div>
                  );
                };

                return (
                  <div key={m.id} className="rounded-xl border border-hairline bg-white p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-navy">
                        Match {m.match_number}
                        {fmtTeeTime(m.tee_time) && (
                          <span className="font-semibold text-navy/50"> · {fmtTeeTime(m.tee_time)}</span>
                        )}
                      </p>
                      <div className="flex items-center gap-3 text-xs">
                        {complete && m.match_score && (
                          <span className="font-bold text-navy">{m.match_score}</span>
                        )}
                        {!complete && underway.has(m.id) && (
                          <span className="text-navy/40">🔒 underway</span>
                        )}
                        {admin && (
                          <>
                            <Link href={`/admin/events/${eventId}/rounds/${round.id}/matchups/${m.id}`}
                              className="text-navy/50 underline underline-offset-2">Edit</Link>
                            <Link href={`/print/match/${m.id}`} target="_blank"
                              className="text-navy/50 underline underline-offset-2">Print</Link>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2.5 items-stretch">
                      {sideBlock("home", homeTeam, m.home_p1, m.home_p2, canEditHome)}
                      <span className="self-center text-xs font-bold text-navy/30">VS</span>
                      {sideBlock("away", awayTeam, m.away_p1, m.away_p2, canEditAway)}
                    </div>

                    <Link href={`/live/match/${m.id}`} className="block text-center text-xs font-semibold text-navy/50 hover:text-navy">
                      Open match →
                    </Link>
                  </div>
                );
              })
            )}
          </div>
        );
      })}
    </div>
  );
}
