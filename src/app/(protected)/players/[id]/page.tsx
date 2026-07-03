import { requirePlayer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PlayerCard } from "@/components/PlayerCard";

type EPRef = { id: string; display_name: string } | null;

export default async function PlayerProfilePage({
  params,
}: {
  params: { id: string };
}) {
  await requirePlayer();
  const supabase = createClient();

  const { data: player } = await supabase
    .from("players")
    .select("*")
    .eq("id", params.id)
    .single();
  if (!player) redirect("/players");

  // Backfilled appearance history (2014+ spreadsheet): year + cup result
  const { data: appearances } = await supabase
    .from("player_appearances")
    .select("year, result")
    .eq("player_id", params.id)
    .order("year", { ascending: false });
  // Timeline span + reigning-champ check come from the cup archive
  const { data: cupResults } = await supabase
    .from("event_results")
    .select("year, event_id")
    .order("year");
  const allYears = (cupResults ?? []).map((r) => r.year);
  const latestYear = allYears.length > 0 ? allYears[allYears.length - 1] : null;

  // Every event this player has been part of (team history)
  const { data: epsRaw } = await supabase
    .from("event_participants")
    .select("id, is_captain, event_id, teams(name, color), events(name, year)")
    .eq("player_id", params.id);
  const eps = (epsRaw ?? []) as unknown as {
    id: string; is_captain: boolean; event_id: string;
    teams: { name: string; color: string } | null;
    events: { name: string; year: number } | null;
  }[];
  const epIds = eps.map((e) => e.id);
  const epIdSet = new Set(epIds);
  const eventById = new Map(eps.map((e) => [e.event_id, e]));

  // Most recent cup team: walk the archive newest-first, but only through
  // events linked in event_results — the real cup lineage — so test events
  // (which can share a year) never color the card.
  let recentTeam: { name: string; color: string; year: number; current: boolean } | null = null;
  for (const r of [...(cupResults ?? [])].reverse()) {
    if (!r.event_id) continue;
    const ep = eps.find((e) => e.event_id === r.event_id);
    if (ep?.teams) {
      recentTeam = { name: ep.teams.name, color: ep.teams.color, year: r.year, current: false };
      break;
    }
  }

  // All matchups this player appears in
  const idList = epIds.join(",");
  const { data: matchupsRaw } = epIds.length > 0
    ? await supabase
        .from("matchups")
        .select(`
          id, round_id, match_number, status, result, match_score,
          rounds(round_number, event_id, formats(name)),
          home_p1:event_participants!matchups_home_p1_id_fkey(id, display_name),
          home_p2:event_participants!matchups_home_p2_id_fkey(id, display_name),
          away_p1:event_participants!matchups_away_p1_id_fkey(id, display_name),
          away_p2:event_participants!matchups_away_p2_id_fkey(id, display_name)
        `)
        .or(`home_p1_id.in.(${idList}),home_p2_id.in.(${idList}),away_p1_id.in.(${idList}),away_p2_id.in.(${idList})`)
    : { data: [] };
  const matchups = (matchupsRaw ?? []) as unknown as {
    id: string; round_id: string; match_number: number; status: string;
    result: string | null; match_score: string | null;
    rounds: { round_number: number; event_id: string; formats: { name: string } | null } | null;
    home_p1: EPRef; home_p2: EPRef; away_p1: EPRef; away_p2: EPRef;
  }[];

  // Career record from completed matches
  type MatchLine = {
    id: string;
    eventId: string;
    roundNumber: number;
    format: string;
    partner: string | null;
    opponents: string;
    outcome: "W" | "L" | "T" | null; // null = not complete
    score: string | null;
  };

  const lines: MatchLine[] = [];
  let wins = 0, losses = 0, ties = 0;

  for (const m of matchups) {
    const onHome = (m.home_p1 && epIdSet.has(m.home_p1.id)) || (m.home_p2 && epIdSet.has(m.home_p2.id));
    const mySide: "home" | "away" = onHome ? "home" : "away";
    const sideEps = mySide === "home" ? [m.home_p1, m.home_p2] : [m.away_p1, m.away_p2];
    const otherEps = mySide === "home" ? [m.away_p1, m.away_p2] : [m.home_p1, m.home_p2];
    const partner = sideEps.find((e) => e && !epIdSet.has(e.id))?.display_name ?? null;
    const opponents = otherEps.filter(Boolean).map((e) => e!.display_name).join(" / ") || "TBD";

    let outcome: MatchLine["outcome"] = null;
    if (m.status === "complete" && m.result) {
      if (m.result === "halve") { outcome = "T"; ties++; }
      else if (m.result === mySide) { outcome = "W"; wins++; }
      else { outcome = "L"; losses++; }
    }

    lines.push({
      id: m.id,
      eventId: m.rounds?.event_id ?? "",
      roundNumber: m.rounds?.round_number ?? 0,
      format: m.rounds?.formats?.name ?? "",
      partner,
      opponents,
      outcome,
      score: m.match_score,
    });
  }

  const points = wins + ties * 0.5;
  const played = wins + losses + ties;

  // Group match lines by event, newest year first
  const byEvent = new Map<string, MatchLine[]>();
  for (const l of lines) {
    const arr = byEvent.get(l.eventId) ?? [];
    arr.push(l);
    byEvent.set(l.eventId, arr);
  }
  const eventGroups = Array.from(byEvent.entries()).sort((a, b) =>
    (eventById.get(b[0])?.events?.year ?? 0) - (eventById.get(a[0])?.events?.year ?? 0));

  const outcomeStyle: Record<string, string> = {
    W: "text-europe-green", L: "text-usa-red", T: "text-navy/50",
  };
  const outcomeWord: Record<string, string> = { W: "Won", L: "Lost", T: "Halved" };

  return (
    <div className="px-4 py-6 space-y-5">
      <Link href="/players" className="text-sm text-navy/50 hover:text-navy">← Players</Link>

      {/* Player card */}
      <PlayerCard
        name={player.name}
        nickname={player.nickname}
        role={player.role}
        index={player.current_index}
        appearances={(appearances ?? []) as { year: number; result: "W" | "L" | "T" }[]}
        allYears={allYears}
        latestYear={latestYear}
        team={recentTeam}
      />

      {/* Cup history: backfilled years, with team chip where the app knows it */}
      {(appearances?.length ?? 0) > 0 && (
        <div>
          <p className="text-xs font-semibold text-navy/50 uppercase tracking-wide mb-2">Cups</p>
          <ul className="space-y-2">
            {appearances!.map((a) => {
              const ep = eps.find((e) => e.events?.year === a.year);
              return (
                <li key={a.year} className="flex items-center justify-between rounded-xl border border-hairline bg-white px-4 py-3">
                  <p className="text-sm font-semibold text-navy tabular-nums">
                    {a.year}
                    {ep?.events?.name && <span className="font-normal text-navy/50"> · {ep.events.name}</span>}
                  </p>
                  <div className="flex items-center gap-2">
                    {ep?.teams && (
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-white"
                        style={{ backgroundColor: ep.teams.color }}>
                        {ep.teams.name}{ep.is_captain ? " · C" : ""}
                      </span>
                    )}
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                      a.result === "W" ? "bg-europe-green/15 text-europe-green"
                      : a.result === "L" ? "bg-usa-red/15 text-usa-red"
                      : "bg-hairline text-navy/60"
                    }`}>
                      {a.result === "W" ? "Won" : a.result === "L" ? "Lost" : "Tied"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* App-tracked match record (2025 onward) */}
      {played > 0 && (
        <div className="rounded-xl border border-hairline bg-parchment px-4 py-3 flex items-center justify-between">
          <p className="text-xs font-semibold text-navy/50 uppercase tracking-wide">Match record</p>
          <p className="text-sm font-bold text-navy tabular-nums">{wins}–{losses}–{ties} · {points} pts</p>
        </div>
      )}

      {/* Matches by event */}
      {eventGroups.map(([eventId, ls]) => {
        const ev = eventById.get(eventId)?.events;
        return (
          <div key={eventId}>
            <p className="text-xs font-semibold text-navy/50 uppercase tracking-wide mb-2">
              {ev ? `${ev.year} — ${ev.name}` : "Matches"}
            </p>
            <ul className="space-y-2">
              {ls.sort((a, b) => a.roundNumber - b.roundNumber).map((l) => (
                <li key={l.id} className="rounded-xl border border-hairline bg-white px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-navy truncate">
                      {l.partner && <span className="text-navy/60">w/ {l.partner} </span>}
                      <span className="text-navy/40">vs</span> {l.opponents}
                    </p>
                    <p className="text-xs text-navy/40 mt-0.5">R{l.roundNumber} · {l.format}</p>
                  </div>
                  <p className={`text-sm font-semibold shrink-0 ${l.outcome ? outcomeStyle[l.outcome] : "text-navy/30"}`}>
                    {l.outcome
                      ? `${outcomeWord[l.outcome]}${l.score && l.outcome !== "T" ? ` ${l.score}` : ""}`
                      : "In progress"}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {matchups.length === 0 && (
        <p className="text-sm text-navy/50">No matches yet.</p>
      )}
    </div>
  );
}
