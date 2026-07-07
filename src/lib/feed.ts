// Clubhouse feed writers. Called from scoring/lineup server actions.
// EVERY writer is best-effort: feed failures must never break scoring,
// so all public functions swallow errors.

import type { createClient } from "@/lib/supabase/server";
import { computePlayingHcps, computeHoleResults, isOneScoreFormat, strokesOnHole } from "./matchcalc";

type Supa = ReturnType<typeof createClient>;
type EPRef = { display_name: string; player_id: string | null } | null;

function holeNums(side: string): number[] {
  if (side === "front") return Array.from({ length: 9 }, (_, i) => i + 1);
  if (side === "back")  return Array.from({ length: 9 }, (_, i) => i + 10);
  return Array.from({ length: 18 }, (_, i) => i + 1);
}

function fmtPts(n: number): string {
  if (n % 1 === 0.5) return n < 1 ? "½" : `${Math.floor(n)}½`;
  return String(n);
}

/** "eagled" / "birdied" / "parred" / ... based on gross vs par */
function deed(gross: number, par: number): string {
  const d = gross - par;
  if (d <= -3) return "made albatross on";
  if (d === -2) return "eagled";
  if (d === -1) return "birdied";
  if (d === 0) return "parred";
  if (d === 1) return "made bogey on";
  return "won";
}

interface MatchContext {
  eventId: string;
  matchNumber: number;
  fmt: { name: string; hcp_allowance: number; hcp_allowance_secondary: number | null };
  nineHole: boolean;
  homeTeam: string;
  awayTeam: string;
  homeNames: string;
  awayNames: string;
  matchup: {
    home_p1: EPRef; home_p2: EPRef; away_p1: EPRef; away_p2: EPRef;
  };
  holes: { hole_number: number; par: number; stroke_index: number }[];
  phcps: ReturnType<typeof computePlayingHcps>;
  scoreMap: Record<number, {
    home_p1_gross: number | null; home_p2_gross: number | null;
    away_p1_gross: number | null; away_p2_gross: number | null;
  }>;
}

async function loadContext(supabase: Supa, matchupId: string): Promise<MatchContext | null> {
  const { data: matchupRaw } = await supabase
    .from("matchups")
    .select(`
      id, round_id, match_number,
      home_p1:event_participants!matchups_home_p1_id_fkey(display_name, player_id),
      home_p2:event_participants!matchups_home_p2_id_fkey(display_name, player_id),
      away_p1:event_participants!matchups_away_p1_id_fkey(display_name, player_id),
      away_p2:event_participants!matchups_away_p2_id_fkey(display_name, player_id)
    `)
    .eq("id", matchupId)
    .single();
  const matchup = matchupRaw as unknown as {
    id: string; round_id: string; match_number: number;
    home_p1: EPRef; home_p2: EPRef; away_p1: EPRef; away_p2: EPRef;
  } | null;
  if (!matchup) return null;

  const { data: roundRaw } = await supabase
    .from("rounds")
    .select("event_id, side, course_tee_id, formats(name, hcp_allowance, hcp_allowance_secondary)")
    .eq("id", matchup.round_id)
    .single();
  const round = roundRaw as unknown as {
    event_id: string; side: string; course_tee_id: string;
    formats: MatchContext["fmt"] | null;
  } | null;
  if (!round?.formats) return null;

  const { data: teams } = await supabase
    .from("teams").select("id, name").eq("event_id", round.event_id).order("name");
  const nineHole = round.side !== "full";

  const { data: holesRaw } = await supabase
    .from("holes")
    .select("hole_number, par, stroke_index")
    .eq("course_tee_id", round.course_tee_id)
    .in("hole_number", holeNums(round.side))
    .order("hole_number");

  const pids = [
    matchup.home_p1?.player_id, matchup.home_p2?.player_id,
    matchup.away_p1?.player_id, matchup.away_p2?.player_id,
  ].filter(Boolean) as string[];
  const { data: hcpRows } = await supabase
    .from("participant_handicaps")
    .select("player_id, calculated_hcp, override_hcp")
    .eq("event_id", round.event_id)
    .eq("course_tee_id", round.course_tee_id)
    .in("player_id", pids.length > 0 ? pids : ["00000000-0000-0000-0000-000000000000"]);
  const eff = (pid: string | null | undefined) => {
    if (!pid) return 0;
    const r = hcpRows?.find((h) => h.player_id === pid);
    return r?.override_hcp ?? r?.calculated_hcp ?? 0;
  };

  const phcps = computePlayingHcps(round.formats, {
    homeP1: eff(matchup.home_p1?.player_id),
    homeP2: matchup.home_p2 ? eff(matchup.home_p2.player_id) : null,
    awayP1: eff(matchup.away_p1?.player_id),
    awayP2: matchup.away_p2 ? eff(matchup.away_p2.player_id) : null,
  }, nineHole);

  const { data: scoresRaw } = await supabase
    .from("hole_scores")
    .select("hole_number, home_p1_gross, home_p2_gross, away_p1_gross, away_p2_gross")
    .eq("matchup_id", matchupId);
  const scoreMap: MatchContext["scoreMap"] = {};
  for (const s of scoresRaw ?? []) scoreMap[s.hole_number] = s;

  const names = (a: EPRef, b: EPRef) =>
    [a?.display_name, b?.display_name].filter(Boolean).join(" / ") || "TBD";

  return {
    eventId: round.event_id,
    matchNumber: matchup.match_number,
    fmt: round.formats,
    nineHole,
    homeTeam: teams?.[0]?.name ?? "Home",
    awayTeam: teams?.[1]?.name ?? "Away",
    homeNames: names(matchup.home_p1, matchup.home_p2),
    awayNames: names(matchup.away_p1, matchup.away_p2),
    matchup,
    holes: holesRaw ?? [],
    scoreMap,
    phcps,
  };
}

/**
 * Emit feed lines for newly decided holes on a matchup, e.g.
 * "Kyle birdied #8 to square the match". Idempotent per (matchup, hole):
 * corrections don't spam or reorder the feed.
 */
export async function recordScoreFeed(supabase: Supa, matchupId: string): Promise<void> {
  try {
    const ctx = await loadContext(supabase, matchupId);
    if (!ctx || ctx.holes.length === 0) return;

    const results = computeHoleResults(ctx.fmt, ctx.phcps, ctx.scoreMap, ctx.holes, ctx.nineHole);

    const { data: existingRows } = await supabase
      .from("feed_events")
      .select("hole_number")
      .eq("matchup_id", matchupId)
      .eq("kind", "hole");
    const existing = new Set((existingRows ?? []).map((r) => r.hole_number));

    const oneScore = isOneScoreFormat(ctx.fmt.name);
    const inserts: { event_id: string; matchup_id: string; kind: string; hole_number: number; message: string }[] = [];

    let diff = 0; // + = home ahead
    for (let i = 0; i < ctx.holes.length; i++) {
      const r = results[i];
      if (r === null) continue;
      if (r === "home") diff++;
      else if (r === "away") diff--;

      const hole = ctx.holes[i];
      const n = hole.hole_number;
      if (existing.has(n)) continue;

      const leader = diff > 0 ? ctx.homeTeam : ctx.awayTeam;
      let message: string;

      // The relevant ball on a side: the player (with team) and gross.
      // Singles → that side's player; Best Ball/Shamble → best-net ball;
      // one-score formats → the team itself.
      const ballFor = (side: "home" | "away"): { name: string; gross: number | null; isTeam: boolean } => {
        const s = ctx.scoreMap[n];
        const team = side === "home" ? ctx.homeTeam : ctx.awayTeam;
        if (oneScore) {
          return { name: team, gross: side === "home" ? s.home_p1_gross : s.away_p1_gross, isTeam: true };
        }
        if (ctx.fmt.name === "Singles") {
          const ep = side === "home" ? ctx.matchup.home_p1 : ctx.matchup.away_p1;
          return {
            name: ep ? `${ep.display_name} (${team})` : team,
            gross: side === "home" ? s.home_p1_gross : s.away_p1_gross,
            isTeam: !ep,
          };
        }
        // Best Ball / Shamble
        const si = hole.stroke_index;
        const allSIs = ctx.holes.map((h) => h.stroke_index);
        const balls = side === "home"
          ? [
              { ep: ctx.matchup.home_p1, gross: s.home_p1_gross, phcp: ctx.phcps.homeP1 },
              { ep: ctx.matchup.home_p2, gross: s.home_p2_gross, phcp: ctx.phcps.homeP2 ?? 0 },
            ]
          : [
              { ep: ctx.matchup.away_p1, gross: s.away_p1_gross, phcp: ctx.phcps.awayP1 },
              { ep: ctx.matchup.away_p2, gross: s.away_p2_gross, phcp: ctx.phcps.awayP2 ?? 0 },
            ];
        const scored = balls
          .filter((b) => b.ep && b.gross != null)
          .map((b) => ({ ...b, net: (b.gross as number) - strokesOnHole(b.phcp, si, allSIs, ctx.nineHole) }))
          .sort((a, b) => a.net - b.net || (a.gross as number) - (b.gross as number));
        const best = scored[0];
        return {
          name: best?.ep ? `${best.ep.display_name} (${team})` : team,
          gross: best?.gross ?? null,
          isTeam: !best?.ep,
        };
      };

      if (r === "halve") {
        const h = ballFor("home");
        const a = ballFor("away");
        const state = diff === 0 ? "all square" : `${leader} still ${Math.abs(diff)} up`;
        message = oneScore
          ? `Hole ${n} halved — ${state}`
          : `${h.name} and ${a.name} halved #${n} — ${state}`;
      } else {
        const winner = ballFor(r);
        const verb = winner.gross != null ? deed(winner.gross, hole.par) : "won";
        const context =
          diff === 0 ? "to square the match"
          : (diff > 0 ? "home" : "away") === r ? `to go ${Math.abs(diff)} up`
          : `to cut the deficit to ${Math.abs(diff)}`;
        message = verb === "won"
          ? `${winner.name} won #${n} ${context}`
          : `${winner.name} ${verb} #${n} ${context}`;
      }

      inserts.push({ event_id: ctx.eventId, matchup_id: matchupId, kind: "hole", hole_number: n, message });
    }

    if (inserts.length > 0) {
      await supabase.from("feed_events").upsert(inserts, {
        onConflict: "matchup_id,kind,hole_number",
        ignoreDuplicates: true,
      });
    }
  } catch {
    // feed is best-effort — never break scoring
  }
}

/**
 * "Team USA (Joey / Ross) def. Team Europe (Stribos / MB) 4&3"
 * plus a standings line ("USA now leads 9½ – 8½").
 */
export async function recordMatchFinal(
  supabase: Supa,
  matchupId: string,
  result: string | null,
  score: string | null,
): Promise<void> {
  try {
    const ctx = await loadContext(supabase, matchupId);
    if (!ctx || !result) return;

    let message: string;
    if (result === "halve") {
      message = `Match ${ctx.matchNumber} halved — ${ctx.homeTeam} (${ctx.homeNames}) & ${ctx.awayTeam} (${ctx.awayNames}) split the point`;
    } else {
      const wTeam = result === "home" ? ctx.homeTeam : ctx.awayTeam;
      const lTeam = result === "home" ? ctx.awayTeam : ctx.homeTeam;
      const wNames = result === "home" ? ctx.homeNames : ctx.awayNames;
      const lNames = result === "home" ? ctx.awayNames : ctx.homeNames;
      message = `Team ${wTeam} (${wNames}) def. Team ${lTeam} (${lNames})${score ? ` ${score}` : ""}`;
    }

    await supabase.from("feed_events").upsert(
      { event_id: ctx.eventId, matchup_id: matchupId, kind: "match_final", hole_number: 0, message },
      { onConflict: "matchup_id,kind,hole_number", ignoreDuplicates: false },
    );

    // Standings after this result
    const { data: rounds } = await supabase.from("rounds").select("id").eq("event_id", ctx.eventId);
    const roundIds = (rounds ?? []).map((r) => r.id);
    if (roundIds.length === 0) return;
    const { data: done } = await supabase
      .from("matchups")
      .select("result")
      .in("round_id", roundIds)
      .eq("status", "complete")
      .not("result", "is", null);
    let home = 0, away = 0;
    for (const m of done ?? []) {
      if (m.result === "home") home++;
      else if (m.result === "away") away++;
      else { home += 0.5; away += 0.5; }
    }
    const standings =
      home === away
        ? `All square at ${fmtPts(home)}–${fmtPts(away)}`
        : home > away
        ? `${ctx.homeTeam} now leads ${fmtPts(home)} to ${fmtPts(away)}`
        : `${ctx.awayTeam} now leads ${fmtPts(away)} to ${fmtPts(home)}`;

    await supabase.from("feed_events").upsert(
      { event_id: ctx.eventId, matchup_id: matchupId, kind: "standings", hole_number: 0, message: standings },
      { onConflict: "matchup_id,kind,hole_number", ignoreDuplicates: false },
    );
  } catch {
    // best-effort
  }
}

/**
 * "Europe set their Match 2 pairing: Joey / Lars".
 * hole_number doubles as the side marker (1 = home, 2 = away) so each side
 * has one updatable feed row per matchup.
 */
export async function recordLineup(
  supabase: Supa,
  matchupId: string,
  side: "home" | "away",
): Promise<void> {
  try {
    const ctx = await loadContext(supabase, matchupId);
    if (!ctx) return;
    const team = side === "home" ? ctx.homeTeam : ctx.awayTeam;
    const names = side === "home" ? ctx.homeNames : ctx.awayNames;
    if (names === "TBD") return; // lineup cleared — nothing to announce

    await supabase.from("feed_events").upsert(
      {
        event_id: ctx.eventId,
        matchup_id: matchupId,
        kind: "lineup",
        hole_number: side === "home" ? 1 : 2,
        message: `${team} set their Match ${ctx.matchNumber} pairing: ${names}`,
        created_at: new Date().toISOString(),
      },
      { onConflict: "matchup_id,kind,hole_number", ignoreDuplicates: false },
    );
  } catch {
    // best-effort
  }
}

/**
 * "💰 Kyle takes $20 off JoeG — Closest to pin". Posts to the active
 * event's feed when a bet is closed (skipped when no event is active).
 */
export async function recordBetClosed(supabase: Supa, betId: string): Promise<void> {
  try {
    const { data: events } = await supabase
      .from("events").select("id").eq("status", "active")
      .order("year", { ascending: false }).limit(1);
    const eventId = events?.[0]?.id;
    if (!eventId) return;

    const { data: betRaw } = await supabase
      .from("bets")
      .select("id, bet_type, amount, description, status, bet_participants(player_id, is_winner, players(nickname, name))")
      .eq("id", betId)
      .single();
    const bet = betRaw as unknown as {
      bet_type: string; amount: number; description: string | null; status: string;
      bet_participants: { player_id: string; is_winner: boolean | null; players: { nickname: string | null; name: string } | null }[];
    } | null;
    if (!bet || bet.status !== "closed") return;

    const nameOf = (p: { players: { nickname: string | null; name: string } | null }) =>
      p.players?.nickname ?? p.players?.name ?? "?";
    const winners = bet.bet_participants.filter((p) => p.is_winner === true);
    const losers = bet.bet_participants.filter((p) => p.is_winner !== true);
    if (winners.length === 0 || losers.length === 0) return;

    const amt = Number(bet.amount);
    const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
    const wNames = winners.map(nameOf).join(" / ");
    const lNames = losers.map(nameOf).join(" / ");
    const tail = bet.description ? ` — ${bet.description}` : "";

    let message: string;
    if (bet.bet_type === "group") {
      const pot = losers.length * amt;
      message = `${wNames} wins ${money(pot)}${tail} (${bet.bet_participants.length}-way)`;
    } else if (winners.length > 1) {
      message = `${wNames} take ${money(amt)} each off ${lNames}${tail}`;
    } else {
      message = `${wNames} takes ${money(amt)} off ${lNames}${tail}`;
    }

    await supabase.from("feed_events").insert({
      event_id: eventId,
      matchup_id: null,
      kind: "bet",
      hole_number: 0,
      message,
    });
  } catch {
    // best-effort
  }
}

/**
 * "⚠️ JoeG protested a bet — CTP ($5)". Public visibility is the
 * enforcement mechanism for the no-acceptance betting model.
 */
export async function recordBetProtest(supabase: Supa, betId: string, protesterLabel: string): Promise<void> {
  try {
    const { data: events } = await supabase
      .from("events").select("id").eq("status", "active")
      .order("year", { ascending: false }).limit(1);
    const eventId = events?.[0]?.id;
    if (!eventId) return;

    const { data: bet } = await supabase
      .from("bets").select("amount, description").eq("id", betId).single();
    if (!bet) return;
    const amt = Number(bet.amount);
    const money = Number.isInteger(amt) ? `$${amt}` : `$${amt.toFixed(2)}`;

    await supabase.from("feed_events").insert({
      event_id: eventId,
      matchup_id: null,
      kind: "bet",
      hole_number: 0,
      message: `⚠️ ${protesterLabel} protested a bet — ${bet.description ?? "side bet"} (${money})`,
    });
  } catch {
    // best-effort
  }
}

/**
 * "🤝 Kyle challenges JoeG — CTP ($5)". Posted when a bet is created, so
 * everyone named in it (and the peanut gallery) knows it exists.
 */
export async function recordBetProposed(supabase: Supa, betId: string): Promise<void> {
  try {
    const { data: events } = await supabase
      .from("events").select("id").eq("status", "active")
      .order("year", { ascending: false }).limit(1);
    const eventId = events?.[0]?.id;
    if (!eventId) return;

    const { data: betRaw } = await supabase
      .from("bets")
      .select("bet_type, amount, description, created_by, bet_participants(player_id, side, players(nickname, name))")
      .eq("id", betId)
      .single();
    const bet = betRaw as unknown as {
      bet_type: string; amount: number; description: string | null; created_by: string | null;
      bet_participants: { player_id: string; side: number | null; players: { nickname: string | null; name: string } | null }[];
    } | null;
    if (!bet) return;

    const nameOf = (p: { players: { nickname: string | null; name: string } | null }) =>
      p.players?.nickname ?? p.players?.name ?? "?";
    const amt = Number(bet.amount);
    const money = Number.isInteger(amt) ? `$${amt}` : `$${amt.toFixed(2)}`;
    const tail = bet.description ? `${bet.description} (${money})` : `${money}`;

    let message: string;
    if (bet.bet_type === "group") {
      const creator = bet.bet_participants.find((p) => p.player_id === bet.created_by);
      const opener = creator ? nameOf(creator) : "Someone";
      message = `🤝 ${opener} opens a group bet — ${tail} · ${bet.bet_participants.length} in`;
    } else {
      const side1 = bet.bet_participants.filter((p) => p.side === 1).map(nameOf).join(" / ");
      const side2 = bet.bet_participants.filter((p) => p.side === 2).map(nameOf).join(" / ");
      const verb = bet.bet_participants.filter((p) => p.side === 1).length > 1 ? "challenge" : "challenges";
      message = `🤝 ${side1} ${verb} ${side2} — ${tail}`;
    }

    await supabase.from("feed_events").insert({
      event_id: eventId,
      matchup_id: null,
      kind: "bet",
      hole_number: 0,
      message,
    });
  } catch {
    // best-effort
  }
}

/**
 * Draft-room announcements: "🐉 The draft is LIVE", "📋 Rd 1 · Pick 1: Joey →
 * Team USA", "✅ The draft is complete". Best-effort like everything here —
 * a feed hiccup must never block a pick.
 */
export async function recordDraftEvent(supabase: Supa, eventId: string, message: string): Promise<void> {
  try {
    await supabase.from("feed_events").insert({
      event_id: eventId,
      matchup_id: null,
      kind: "draft",
      hole_number: 0,
      message,
    });
  } catch {
    // best-effort
  }
}
