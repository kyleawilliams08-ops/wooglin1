// USGA handicap calculations for Wooglin Cup formats

export interface Tee {
  rating: number;
  slope: number;
  par: number;
}

export interface Format {
  hcp_allowance: number;           // % for primary player (or only player)
  hcp_allowance_secondary?: number | null; // % for high-hcp player (Scramble only)
}

/**
 * USGA course handicap formula.
 * Result is rounded to nearest integer per USGA rules.
 */
export function courseHandicap(index: number, tee: Tee): number {
  return Math.round(index * (tee.slope / 113) + (tee.rating - tee.par));
}

/**
 * Apply a format allowance percentage to a course handicap.
 * Result is truncated (floor) per USGA recommendation for team formats.
 */
export function playingHandicap(courseHcp: number, allowancePct: number): number {
  return Math.floor(courseHcp * (allowancePct / 100));
}

/**
 * Number of strokes a player receives on a given hole.
 * Returns 0, 1, or 2 (double-stroke for hdcp > 18).
 */
export function strokesOnHole(playingHcp: number, strokeIndex: number): number {
  if (playingHcp <= 0) return 0;
  if (strokeIndex <= playingHcp % 18 || playingHcp >= 18) {
    return Math.floor(playingHcp / 18) + (strokeIndex <= playingHcp % 18 ? 1 : 0);
  }
  return Math.floor(playingHcp / 18);
}

/**
 * Net score on a hole: gross minus strokes received.
 */
export function netScore(gross: number, playingHcp: number, strokeIndex: number): number {
  return gross - strokesOnHole(playingHcp, strokeIndex);
}

// ---------------------------------------------------------------------------
// Format-level helpers
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
  format: Format
): ScramblerHandicaps {
  const hcpA = courseHandicap(indexA, tee);
  const hcpB = courseHandicap(indexB, tee);
  const [lowCourse, highCourse] = hcpA <= hcpB ? [hcpA, hcpB] : [hcpB, hcpA];
  const secondaryPct = format.hcp_allowance_secondary ?? 0;
  return {
    lowPlayingHcp:  playingHandicap(lowCourse,  format.hcp_allowance),
    highPlayingHcp: playingHandicap(highCourse, secondaryPct),
  };
}

/**
 * Best Ball / Shamble / Pinehurst: both players use the same allowance %.
 */
export function partnerHandicaps(
  indexA: number,
  indexB: number,
  tee: Tee,
  format: Format
): { hcpA: number; hcpB: number } {
  return {
    hcpA: playingHandicap(courseHandicap(indexA, tee), format.hcp_allowance),
    hcpB: playingHandicap(courseHandicap(indexB, tee), format.hcp_allowance),
  };
}

/**
 * Singles match play: full allowance (100%), difference-based.
 * Lower handicap player receives 0 strokes; higher receives the difference.
 */
export function singlesHandicaps(
  indexA: number,
  indexB: number,
  tee: Tee,
  format: Format
): { hcpA: number; hcpB: number } {
  const rawA = playingHandicap(courseHandicap(indexA, tee), format.hcp_allowance);
  const rawB = playingHandicap(courseHandicap(indexB, tee), format.hcp_allowance);
  const low = Math.min(rawA, rawB);
  return {
    hcpA: rawA - low,
    hcpB: rawB - low,
  };
}
