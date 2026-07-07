/**
 * Snake-draft order math. Pure functions, mirrored by draft.test.ts.
 *
 * Two teams, picks alternate A B | B A | A B … ("snake"). Team A is whoever
 * holds the first pick. Pick numbers are 1-based. The pool can be odd —
 * the sequence just stops, leaving one team a player heavier.
 */

/** Round for a 1-based pick number (2 picks per round). */
export function roundForPick(pickNumber: number): number {
  return Math.ceil(pickNumber / 2);
}

/**
 * Which team picks: 0 = the first-pick team, 1 = the other team.
 * Odd rounds run forward (A, B); even rounds are reversed (B, A).
 */
export function teamIndexForPick(pickNumber: number): 0 | 1 {
  const posInRound = (pickNumber - 1) % 2;
  const forward = roundForPick(pickNumber) % 2 === 1;
  return (forward ? posInRound : 1 - posInRound) as 0 | 1;
}

/** "Rd 2 · Pick 3" label for boards and the feed. */
export function pickLabel(pickNumber: number): string {
  return `Rd ${roundForPick(pickNumber)} · Pick ${pickNumber}`;
}

/**
 * Seconds left on the soft clock (can go negative — the UI shames, nothing
 * auto-fires). Null when the clock hasn't been started.
 */
export function clockRemaining(
  pickStartedAt: string | null,
  pickSeconds: number,
  now: number = Date.now(),
): number | null {
  if (!pickStartedAt) return null;
  return pickSeconds - Math.floor((now - new Date(pickStartedAt).getTime()) / 1000);
}
