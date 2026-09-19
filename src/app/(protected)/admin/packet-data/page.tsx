import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCurrentEvent } from "@/lib/currentEvent";
import { redirect } from "next/navigation";
import Link from "next/link";
import { courseHandicap, playingHandicap } from "@/lib/handicap";
import { CopyButton } from "@/components/CopyButton";
import { DownloadTextButton } from "@/components/DownloadTextButton";

export const dynamic = "force-dynamic";

// Everything the printed trip packet needs, as one JSON blob — rosters, indexes,
// course + 9-hole playing handicaps (computed by the SAME engine the scorecards
// use, so packet and app can't disagree), rounds, tee times, CTP holes and the
// champions list. Read-only.
export default async function PacketDataPage() {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");
  const supabase = createClient();

  const event = await getCurrentEvent(supabase);
  if (!event) {
    return <div className="px-4 py-6 text-sm text-navy/60">No active event.</div>;
  }

  const [{ data: eventRow }, { data: teams }, { data: partsRaw }, { data: roundsRaw }, { data: hcpRows }, { data: results }] =
    await Promise.all([
      supabase.from("events").select("*").eq("id", event.id).single(),
      supabase.from("teams").select("id, name, color").eq("event_id", event.id).order("name"),
      supabase.from("event_participants")
        .select("id, player_id, team_id, display_name, is_captain, players(name, nickname, current_index)")
        .eq("event_id", event.id),
      supabase.from("rounds")
        .select("id, round_number, name, side, played_at, course_tee_id, formats(name, team_size, hcp_allowance, hcp_allowance_secondary), course_tees(id, tee_name, rating, slope, par, courses(name))")
        .eq("event_id", event.id).order("round_number"),
      supabase.from("participant_handicaps")
        .select("player_id, course_tee_id, calculated_hcp, override_hcp").eq("event_id", event.id),
      supabase.from("event_results")
        .select("year, winner, final_score, location, captains, roster, losing_roster, notes")
        .order("year", { ascending: false }),
    ]);

  type Part = {
    id: string; player_id: string | null; team_id: string | null; display_name: string; is_captain: boolean;
    players: { name: string; nickname: string | null; current_index: number | null } | null;
  };
  type Round = {
    id: string; round_number: number; name: string | null; side: string; played_at: string | null; course_tee_id: string;
    formats: { name: string; team_size: number | null; hcp_allowance: number; hcp_allowance_secondary: number | null } | null;
    course_tees: { id: string; tee_name: string; rating: number; slope: number; par: number; courses: { name: string } | null } | null;
  };
  const parts = (partsRaw ?? []) as unknown as Part[];
  const rounds = (roundsRaw ?? []) as unknown as Round[];
  const roundIds = rounds.map((r) => r.id);
  const teeIds = Array.from(new Set(rounds.map((r) => r.course_tee_id)));
  const playerIds = parts.map((p) => p.player_id).filter((x): x is string => !!x);

  const [{ data: matchups }, { data: ctps }, { data: holes }, { data: apps }] = await Promise.all([
    roundIds.length
      ? supabase.from("matchups")
          .select("round_id, match_number, tee_time, home_p1_id, home_p2_id, away_p1_id, away_p2_id, formats(name)")
          .in("round_id", roundIds).order("match_number")
      : Promise.resolve({ data: [] as never[] }),
    roundIds.length
      ? supabase.from("ctp_holes").select("round_id, hole_number, stake").in("round_id", roundIds)
      : Promise.resolve({ data: [] as never[] }),
    teeIds.length
      ? supabase.from("holes").select("course_tee_id, hole_number, par, stroke_index").in("course_tee_id", teeIds).order("hole_number")
      : Promise.resolve({ data: [] as never[] }),
    playerIds.length
      ? supabase.from("player_appearances").select("player_id, year, result").in("player_id", playerIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const nameOf = (id: string | null) => {
    const p = parts.find((x) => x.id === id);
    return p ? p.players?.nickname ?? p.display_name : null;
  };

  // Course handicap at a tee: saved value if present, else computed from the index
  const chAt = (p: Part, tee: NonNullable<Round["course_tees"]>): number | null => {
    const row = (hcpRows ?? []).find((h) => h.player_id === p.player_id && h.course_tee_id === tee.id);
    const saved = row?.override_hcp ?? row?.calculated_hcp;
    if (saved != null) return saved;
    const idx = p.players?.current_index;
    return idx == null ? null : courseHandicap(idx, tee);
  };

  // Points come from the matchups that actually exist: 1 per match, and the
  // Cup is won at half the total plus a half.
  const matchCount = (roundId: string) => (matchups ?? []).filter((m) => m.round_id === roundId).length;
  const totalPoints = rounds.reduce((n, r) => n + matchCount(r.id), 0);
  const emptyRounds = rounds.filter((r) => matchCount(r.id) === 0)
    .map((r) => `R${r.round_number}${r.name ? ` ${r.name}` : ""}`);

  const data = {
    generated_at: new Date().toISOString(),
    event: eventRow,
    points: {
      total_available: totalPoints,
      needed_to_win: totalPoints / 2 + 0.5,
      matches_per_round: rounds.map((r) => ({ round: r.round_number, name: r.name, matches: matchCount(r.id) })),
      // A round with no tee times adds no points yet — add them before printing
      rounds_with_no_matches: emptyRounds,
    },
    teams: (teams ?? []).map((t) => ({
      name: t.name.trim(), color: t.color,
      players: parts.filter((p) => p.team_id === t.id)
        .map((p) => {
          const mine = (apps ?? []).filter((a) => a.player_id === p.player_id);
          return {
            name: p.players?.name ?? p.display_name,
            nickname: p.players?.nickname ?? null,
            captain: p.is_captain,
            index: p.players?.current_index ?? null,
            cups_before_this_year: mine.filter((a) => a.year < (eventRow?.year ?? 9999)).length,
            cup_record: `${mine.filter((a) => a.result === "W").length}-${mine.filter((a) => a.result === "L").length}-${mine.filter((a) => a.result === "T").length}`,
            // per round: course handicap + the 9/18-hole playing handicap(s) for that format
            handicaps: rounds.filter((r) => r.course_tees && r.formats).map((r) => {
              const ch = chAt(p, r.course_tees!);
              const nine = r.side !== "full";
              const f = r.formats!;
              return {
                round: r.round_number,
                course_hcp: ch,
                playing: ch == null ? null : playingHandicap(ch, f.hcp_allowance, nine),
                playing_secondary: ch == null || f.hcp_allowance_secondary == null
                  ? null : playingHandicap(ch, f.hcp_allowance_secondary, nine),
              };
            }),
          };
        })
        .sort((a, b) => Number(b.captain) - Number(a.captain) || a.name.localeCompare(b.name)),
    })),
    unassigned: parts.filter((p) => !p.team_id).map((p) => p.players?.name ?? p.display_name),
    rounds: rounds.map((r) => ({
      round: r.round_number, name: r.name, date: r.played_at, side: r.side,
      course: r.course_tees?.courses?.name, tee: r.course_tees?.tee_name,
      rating: r.course_tees?.rating, slope: r.course_tees?.slope, par: r.course_tees?.par,
      format: r.formats?.name, team_size: r.formats?.team_size,
      allowance: r.formats?.hcp_allowance, allowance_secondary: r.formats?.hcp_allowance_secondary,
      ctp_holes: (ctps ?? []).filter((c) => c.round_id === r.id).map((c) => ({ hole: c.hole_number, stake: c.stake })),
      matches: (matchups ?? []).filter((m) => m.round_id === r.id).map((m) => ({
        match: m.match_number, tee_time: m.tee_time,
        format_override: (m.formats as unknown as { name: string } | null)?.name ?? null,
        home: [nameOf(m.home_p1_id), nameOf(m.home_p2_id)].filter(Boolean),
        away: [nameOf(m.away_p1_id), nameOf(m.away_p2_id)].filter(Boolean),
      })),
    })),
    tees: teeIds.map((id) => {
      const r = rounds.find((x) => x.course_tee_id === id)!;
      return {
        course: r.course_tees?.courses?.name, tee: r.course_tees?.tee_name,
        holes: (holes ?? []).filter((h) => h.course_tee_id === id)
          .map((h) => ({ hole: h.hole_number, par: h.par, si: h.stroke_index })),
      };
    }),
    champions: results ?? [],
  };

  const json = JSON.stringify(data, null, 2);

  return (
    <div className="px-4 py-6 space-y-4">
      <Link href="/menu" className="text-sm text-navy/50 hover:text-navy">← Menu</Link>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy">Packet Data</h1>
          <p className="mt-1 text-sm text-navy/60">
            {event.name} — rosters, handicaps, rounds, tee times, CTP holes and champions, for building the
            printed trip packet. Handicaps come from the same engine as the scorecards.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <DownloadTextButton text={json} filename={`wooglin-packet-data-${eventRow?.year ?? "event"}.txt`} label="Download .txt" />
          <CopyButton text={json} label="Copy all" />
        </div>
      </div>

      <div className={`rounded-xl border px-4 py-3 text-sm ${emptyRounds.length ? "border-usa-red bg-usa-red/10 text-usa-red" : "border-hairline bg-white text-navy"}`}>
        <p className="font-semibold">
          {totalPoints} points available · {totalPoints / 2 + 0.5} wins the Cup
        </p>
        <p className="text-xs opacity-80">
          Counted from the tee times in the app ({rounds.map((r) => `R${r.round_number}: ${matchCount(r.id)}`).join(" · ")}).
          {emptyRounds.length > 0 && ` ${emptyRounds.join(", ")} ${emptyRounds.length === 1 ? "has" : "have"} no tee times yet — add them so the points are right.`}
        </p>
      </div>
      <pre className="max-h-[70vh] overflow-auto rounded-xl border border-hairline bg-white p-3 text-[11px] leading-snug text-navy">
        {json}
      </pre>
    </div>
  );
}
