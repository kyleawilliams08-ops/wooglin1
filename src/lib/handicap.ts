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
 * Singles match play: difference-based. Lower-hcp player gets 0; higher gets the diff.
 * Pass the result directly into strokesGivenOnHole for each hole.
 */
export function singlesHandicaps(
  indexA: number,
  indexB: number,
  tee: Tee,
  format: Format,
  nineHole = false,
): { hcpA: number; hcpB: number } {
  const rawA = playingHandicap(courseHandicap(indexA, tee), format.hcp_allowance, nineHole);
  const rawB = playingHandicap(courseHandicap(indexB, tee), format.hcp_allowance, nineHole);
  const low = Math.min(rawA, rawB);
  return {
    hcpA: rawA - low,
    hcpB: rawB - low,
  };
}
