import { requirePlayer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

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

      {/* Header */}
      <div>
        <h1 className="text-2xl font-display font-bold text-navy">
          {player.name}
          {player.nickname && player.nickname !== player.name && (
            <span className="text-navy/40 font-normal text-lg"> · &ldquo;{player.nickname}&rdquo;</span>
          )}
        </h1>
        <p className="text-sm text-navy/50 mt-0.5 uppercase tracking-wide">{player.role}</p>
      </div>

      {/* Index + record */}
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-xl border border-hairline bg-white px-2 py-3">
          <p className="text-2xl font-bold text-navy tabular-nums">{player.current_index ?? "—"}</p>
          <p className="text-xs text-navy/50 mt-0.5">Index</p>
        </div>
        <div className="rounded-xl border border-hairline bg-white px-2 py-3">
          <p className="text-2xl font-bold text-navy tabular-nums">{wins}–{losses}–{ties}</p>
          <p className="text-xs text-navy/50 mt-0.5">W–L–T</p>
        </div>
        <div className="rounded-xl border border-hairline bg-white px-2 py-3">
          <p className="text-2xl font-bold text-navy tabular-nums">{played > 0 ? points : "—"}</p>
          <p className="text-xs text-navy/50 mt-0.5">Points</p>
        </div>
      </div>

      {/* Team history */}
      {eps.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-navy/50 uppercase tracking-wide mb-2">Cups</p>
          <ul className="space-y-2">
            {[...eps]
              .sort((a, b) => (b.events?.year ?? 0) - (a.events?.year ?? 0))
              .map((e) => (
                <li key={e.id} className="flex items-center justify-between rounded-xl border border-hairline bg-white px-4 py-3">
                  <p className="text-sm font-semibold text-navy">
                    {e.events?.year} · {e.events?.name}
                  </p>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-white"
                    style={{ backgroundColor: e.teams?.color ?? "#0C2D55" }}>
                    {e.teams?.name ?? "—"}{e.is_captain ? " · C" : ""}
                  </span>
                </li>
              ))}
          </ul>
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
