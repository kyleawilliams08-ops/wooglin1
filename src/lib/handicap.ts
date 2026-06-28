// USGA handicap calculations for Wooglin Cup formats

export interface Tee {
  rating: number;
  slope: number;
  par: number;
}

export interface Format {
  hcp_allowance: number;            // % for primary player (or only player)
  hcp_allowance_secondary?: number | null; // % for high-hcp player (Scramble only)
}

/**
 * Round to nearest 0.5. Ties (e.g. 4.25, 7.75) round up.
 * Applied as the final step after all format/9-hole adjustments.
 *   4.25 → 4.5   |   7.75 → 8.0   |   7.4 → 7.5   |   7.6 → 7.5
 */
export function roundToHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

/**
 * USGA course handicap formula. Result is a whole number per USGA rules.
 * This is the per-tee base handicap stored in participant_handicaps.
 */
export function courseHandicap(index: number, tee: Tee): number {
  return Math.round(index * (tee.slope / 113) + (tee.rating - tee.par));
}

/**
 * Final playing handicap after applying:
 *   1. 9-hole halving (if applicable)
 *   2. Format allowance %
 *   3. Round to nearest 0.5
 */
export function playingHandicap(
  courseHcp: number,
  allowancePct: number,
  nineHole = false,
): number {
  let hcp = courseHcp;
  if (nineHole) hcp = hcp / 2;
  return roundToHalf(hcp * (allowancePct / 100));
}

/**
 * How many strokes a player receives on a specific hole.
 * Pass the playing handicap for this player (in singles, use the difference
 * returned by singlesHandicaps; in team formats, use each player's own hcp).
 * Returns 0, 1, or 2 (double-stroke when hcp > 18).
 */
export function strokesGivenOnHole(playingHcp: number, strokeIndex: number): number {
  if (playingHcp <= 0) return 0;
  const full  = Math.floor(playingHcp / 18);
  const extra = playingHcp % 18;
  return full + (strokeIndex <= extra ? 1 : 0);
}

/**
 * Net score on a hole: gross minus strokes received.
 */
export function netScore(gross: number, playingHcp: number, strokeIndex: number): number {
  return gross - strokesGivenOnHole(playingHcp, strokeIndex);
}

// ---------------------------------------------------------------------------
// Format-level helpers — return playing handicaps ready for hole-by-hole use
// ---------------------------------------------------------------------------

export interface ScramblerHandicaps {
  lowPlayingHcp: number;
  highPlayingHcp: number;
}

/**
 * Scramble: low-hcp player uses hcp_allowance, high-hcp uses hcp_allowance_secondary.
 * The "low" player is determined by course handicap before allowance.
 */
export function scrambleHandicaps(
  indexA: number,
  indexB: number,
  tee: Tee,
  format: Format,
  nineHole = false,
): ScramblerHandicaps {
  const hcpA = courseHandicap(indexA, tee);
  const hcpB = courseHandicap(indexB, tee);
  const [lowCourse, highCourse] = hcpA <= hcpB ? [hcpA, hcpB] : [hcpB, hcpA];
  const secondaryPct = format.hcp_allowance_secondary ?? 0;
  return {
    lowPlayingHcp:  playingHandicap(lowCourse,  format.hcp_allowance, nineHole),
    highPlayingHcp: playingHandicap(highCourse, secondaryPct, nineHole),
  };
}

/**
 * Best Ball / Shamble / Pinehurst: both players use the same allowance %.
 */
export function partnerHandicaps(
  indexA: number,
  indexB: number,
  tee: Tee,
  format: Format,
  nineHole = false,
): { hcpA: number; hcpB: number } {
  return {
    hcpA: playingHandicap(courseHandicap(indexA, tee), format.hcp_allowance, nineHole),
    hcpB: playingHandicap(courseHandicap(indexB, tee), format.hcp_allowance, nineHole),
  };
}

/**
 * Normalize an array of playing handicaps so the lowest becomes 0 and
 * everyone else receives the difference. Works for any group size.
 *
 * Used by Best Ball (4-player group) and Singles (2-player group):
 *   [6, 7, 4, 10] → [2, 3, 0, 6]
 */
export function normalizeToLowest(playingHcps: number[]): number[] {
  const low = Math.min(...playingHcps);
  return playingHcps.map((h) => roundToHalf(h - low));
}

/**
 * Best Ball / Shamble (4 balls holed):
 * Each player's individual playing hcp is calculated, then normalized so the
 * lowest in the group gets 0 and everyone else receives the difference.
 * Pass all 4 indexes; order matches the returned array.
 */
export function groupHandicaps(
  indexes: number[],
  tee: Tee,
  format: Format,
  nineHole = false,
): number[] {
  const playing = indexes.map((idx) =>
    playingHandicap(courseHandicap(idx, tee), format.hcp_allowance, nineHole)
  );
  return normalizeToLowest(playing);
}

/**
 * Singles (2 balls holed):
 * Convenience wrapper — lower-hcp player gets 0, higher gets the diff.
 */
export function singlesHandicaps(
  indexA: number,
  indexB: number,
  tee: Tee,
  format: Format,
  nineHole = false,
): { hcpA: number; hcpB: number } {
  const [hcpA, hcpB] = groupHandicaps([indexA, indexB], tee, format, nineHole);
  return { hcpA, hcpB };
}

/**
 * Pinehurst / Scramble (1 ball holed):
 * Each team's handicap = sum of both players' playing handicaps (rounded to 0.5).
 * The two team totals are then normalized so the lower team gets 0 net strokes.
 *
 * For Scramble: low player uses hcp_allowance (35%), high player uses
 * hcp_allowance_secondary (15%) — use scrambleHandicaps() to get the two
 * playing hcps, then pass them here.
 *
 * For Pinehurst: both players use hcp_allowance (50%) — use partnerHandicaps()
 * to get the two playing hcps, then pass them here.
 */
export function teamHandicap(playingHcpA: number, playingHcpB: number): number {
  return roundToHalf(playingHcpA + playingHcpB);
}

/**
 * Returns net strokes for each of the two teams after normalizing to lowest.
 * teamA / teamB are the outputs of teamHandicap() for each pairing.
 */
export function twoTeamHandicaps(
  teamAHcp: number,
  teamBHcp: number,
): { teamA: number; teamB: number } {
  const [teamA, teamB] = normalizeToLowest([teamAHcp, teamBHcp]);
  return { teamA, teamB };
}
