// Match-play result computation shared by the scorecard, review, and complete flows.

export type HoleResult = "home" | "away" | "halve" | null;

export interface MatchOutcome {
  /** Winning side, or "halve" for a tie, or null when no holes are scored yet. */
  result: "home" | "away" | "halve" | null;
  /** Bare score string for storage/display, e.g. "2&1", "1 up", "Halved", "All Square". */
  score: string | null;
  /** True once the match is mathematically settled (clinched early or all holes played). */
  decided: boolean;
  homeWon: number;
  awayWon: number;
  holesPlayed: number;
  /** Holes without a score yet (totalHoles - holesPlayed). */
  remaining: number;
}

/**
 * Walk holes in order tracking the running margin. The match is decided the
 * moment a side leads by more holes than remain (e.g. 2 up with 1 to play = "2&1").
 * `results` must be in hole order; nulls (unscored holes) are skipped.
 */
export function matchOutcome(results: HoleResult[], totalHoles: number): MatchOutcome {
  let diff = 0; // positive = home ahead
  let homeWon = 0, awayWon = 0, holesPlayed = 0;

  for (const r of results) {
    if (r === null) continue;
    holesPlayed++;
    if (r === "home") { diff++; homeWon++; }
    else if (r === "away") { diff--; awayWon++; }

    const remaining = totalHoles - holesPlayed;
    if (Math.abs(diff) > remaining) {
      return {
        result: diff > 0 ? "home" : "away",
        score: remaining === 0 ? `${Math.abs(diff)} up` : `${Math.abs(diff)}&${remaining}`,
        decided: true,
        homeWon, awayWon, holesPlayed, remaining,
      };
    }
  }

  const remaining = totalHoles - holesPlayed;

  if (holesPlayed === 0) {
    return { result: null, score: null, decided: false, homeWon, awayWon, holesPlayed, remaining };
  }

  // Not clinched early.
  if (holesPlayed >= totalHoles) {
    // All holes played and not clinched → tied.
    return { result: "halve", score: "Halved", decided: true, homeWon, awayWon, holesPlayed, remaining };
  }

  // In progress.
  if (diff === 0) {
    return { result: "halve", score: "All Square", decided: false, homeWon, awayWon, holesPlayed, remaining };
  }
  return {
    result: diff > 0 ? "home" : "away",
    score: `${Math.abs(diff)} up`,
    decided: false,
    homeWon, awayWon, holesPlayed, remaining,
  };
}

/**
 * Human-readable badge label for the match, using team names.
 * Returns null when no holes are scored yet.
 */
export function outcomeBadge(o: MatchOutcome, homeName: string, awayName: string): string | null {
  if (o.result === null) return null;
  if (o.result === "halve") {
    return o.decided ? "Halved" : `All Square (${o.remaining} to play)`;
  }
  const name = o.result === "home" ? homeName : awayName;
  return o.decided ? `${name} wins ${o.score}` : `${name} ${o.score} (${o.remaining} to play)`;
}
