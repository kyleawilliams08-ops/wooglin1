// Per-matchup computation shared by the admin scorecard and the live scoreboard:
// playing handicaps by format, strokes per hole, and per-hole results.
// Pure module — no DB calls.

import {
  playingHandicap,
  normalizeToLowest,
  strokesGivenOnHole,
  nineHoleSIRank,
  teamHandicap,
  twoTeamHandicaps,
} from "./handicap";
import type { HoleResult } from "./matchplay";

export interface FormatInfo {
  name: string;
  hcp_allowance: number;
  hcp_allowance_secondary: number | null;
}

export interface CourseHcps {
  homeP1: number;
  homeP2: number | null; // null = no partner (Singles or 2v1 solo)
  awayP1: number;
  awayP2: number | null;
}

export interface PlayingHcps {
  homeP1: number;
  homeP2: number | null;
  awayP1: number;
  awayP2: number | null;
  homeTeam: number | null; // set for one-score formats (Pinehurst / Scramble)
  awayTeam: number | null;
}

export interface HoleInfo {
  hole_number: number;
  par: number;
  stroke_index: number;
}

export interface GrossScores {
  home_p1_gross: number | null;
  home_p2_gross: number | null;
  away_p1_gross: number | null;
  away_p2_gross: number | null;
}

export const isOneScoreFormat = (fmtName: string) =>
  ["Pinehurst", "Scramble"].includes(fmtName);

/**
 * Playing handicaps for all balls in the match, per format:
 * - Singles: both players normalized to the lower (low plays 0)
 * - Best Ball / Shamble: all balls in one group, normalized to lowest
 * - Pinehurst: team = sum of 50% playing hcps, two teams normalized
 * - Scramble: low 35% + high 15% per team (2v1 solo: 50% of own), normalized
 */
export function computePlayingHcps(
  fmt: FormatInfo,
  ch: CourseHcps,
  nineHole: boolean,
): PlayingHcps {
  const pct  = fmt.hcp_allowance;
  const pct2 = fmt.hcp_allowance_secondary ?? 0;

  const out: PlayingHcps = {
    homeP1: 0, homeP2: null, awayP1: 0, awayP2: null,
    homeTeam: null, awayTeam: null,
  };

  if (fmt.name === "Singles") {
    const [h, a] = normalizeToLowest([
      playingHandicap(ch.homeP1, pct, nineHole),
      playingHandicap(ch.awayP1, pct, nineHole),
    ]);
    out.homeP1 = h;
    out.awayP1 = a;

  } else if (fmt.name === "Pinehurst") {
    const homeRaw = ch.homeP2 !== null
      ? teamHandicap(playingHandicap(ch.homeP1, pct, nineHole), playingHandicap(ch.homeP2, pct, nineHole))
      : playingHandicap(ch.homeP1, pct, nineHole); // 2v1
    const awayRaw = ch.awayP2 !== null
      ? teamHandicap(playingHandicap(ch.awayP1, pct, nineHole), playingHandicap(ch.awayP2, pct, nineHole))
      : playingHandicap(ch.awayP1, pct, nineHole);
    const { teamA, teamB } = twoTeamHandicaps(homeRaw, awayRaw);
    out.homeTeam = teamA;
    out.awayTeam = teamB;

  } else if (fmt.name === "Scramble") {
    const scrambleTeamHcp = (p1: number, p2: number | null) => {
      if (p2 === null) return playingHandicap(p1, 50, nineHole); // 2v1: 35+15 of own
      const [low, high] = p1 <= p2 ? [p1, p2] : [p2, p1];
      return teamHandicap(
        playingHandicap(low, pct, nineHole),
        playingHandicap(high, pct2, nineHole),
      );
    };
    const { teamA, teamB } = twoTeamHandicaps(
      scrambleTeamHcp(ch.homeP1, ch.homeP2),
      scrambleTeamHcp(ch.awayP1, ch.awayP2),
    );
    out.homeTeam = teamA;
    out.awayTeam = teamB;

  } else {
    // Best Ball / Shamble: all balls in one group, normalize to lowest
    type Entry = { key: "homeP1" | "homeP2" | "awayP1" | "awayP2"; ch: number };
    const entries: Entry[] = [{ key: "homeP1", ch: ch.homeP1 }];
    if (ch.homeP2 !== null) entries.push({ key: "homeP2", ch: ch.homeP2 });
    entries.push({ key: "awayP1", ch: ch.awayP1 });
    if (ch.awayP2 !== null) entries.push({ key: "awayP2", ch: ch.awayP2 });

    const normalized = normalizeToLowest(
      entries.map((e) => playingHandicap(e.ch, pct, nineHole)),
    );
    entries.forEach((e, i) => { out[e.key] = normalized[i]; });
  }

  return out;
}

/**
 * Strokes a ball receives on a hole, using the re-ranked SI and the correct
 * wraparound base for 9-hole rounds.
 */
export function strokesOnHole(
  phcp: number,
  rawSI: number,
  allHoleSIs: number[],
  nineHole: boolean,
): number {
  const si = nineHole ? nineHoleSIRank(rawSI, allHoleSIs) : rawSI;
  return strokesGivenOnHole(phcp, si, nineHole ? 9 : 18);
}

/**
 * Result of one hole given the gross scores, or null if not enough scores
 * are entered to decide it.
 */
export function computeHoleResult(
  fmt: FormatInfo,
  phcps: PlayingHcps,
  scores: GrossScores | undefined,
  hole: HoleInfo,
  allHoleSIs: number[],
  nineHole: boolean,
): HoleResult {
  if (!scores) return null;
  const si = hole.stroke_index;
  const strokes = (phcp: number) => strokesOnHole(phcp, si, allHoleSIs, nineHole);

  if (isOneScoreFormat(fmt.name)) {
    const hGross = scores.home_p1_gross;
    const aGross = scores.away_p1_gross;
    if (hGross == null || aGross == null) return null;
    const hNet = hGross - strokes(phcps.homeTeam ?? 0);
    const aNet = aGross - strokes(phcps.awayTeam ?? 0);
    return hNet < aNet ? "home" : aNet < hNet ? "away" : "halve";
  }

  if (fmt.name === "Singles") {
    const hGross = scores.home_p1_gross;
    const aGross = scores.away_p1_gross;
    if (hGross == null || aGross == null) return null;
    const hNet = hGross - strokes(phcps.homeP1);
    const aNet = aGross - strokes(phcps.awayP1);
    return hNet < aNet ? "home" : aNet < hNet ? "away" : "halve";
  }

  // Best Ball / Shamble
  const homeNets: number[] = [];
  if (scores.home_p1_gross != null) homeNets.push(scores.home_p1_gross - strokes(phcps.homeP1));
  if (scores.home_p2_gross != null && phcps.homeP2 != null)
    homeNets.push(scores.home_p2_gross - strokes(phcps.homeP2));
  const awayNets: number[] = [];
  if (scores.away_p1_gross != null) awayNets.push(scores.away_p1_gross - strokes(phcps.awayP1));
  if (scores.away_p2_gross != null && phcps.awayP2 != null)
    awayNets.push(scores.away_p2_gross - strokes(phcps.awayP2));

  if (homeNets.length === 0 || awayNets.length === 0) return null;
  const bestH = Math.min(...homeNets);
  const bestA = Math.min(...awayNets);
  return bestH < bestA ? "home" : bestA < bestH ? "away" : "halve";
}

/**
 * Ordered per-hole results for a whole matchup — feed into matchOutcome().
 */
export function computeHoleResults(
  fmt: FormatInfo,
  phcps: PlayingHcps,
  scoreMap: Record<number, GrossScores>,
  holes: HoleInfo[],
  nineHole: boolean,
): HoleResult[] {
  const allHoleSIs = holes.map((h) => h.stroke_index);
  return holes.map((h) =>
    computeHoleResult(fmt, phcps, scoreMap[h.hole_number], h, allHoleSIs, nineHole),
  );
}
