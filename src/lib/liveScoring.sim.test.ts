// Dress rehearsal for the live-scoring pipeline: plays whole matches through
// the same pure functions the scorer, /matches board and feed all use
// (computePlayingHcps → computeHoleResults → matchOutcome), one hole at a time,
// the way scores actually arrive from phones on the course.

import { describe, it, expect } from "vitest";
import {
  computePlayingHcps, computeHoleResults, effectiveFormat,
  type FormatInfo, type GrossScores, type HoleInfo,
} from "./matchcalc";
import { matchOutcome } from "./matchplay";
import { betNets, ledgerNets, type BetForNet } from "./bets";

const bestBall: FormatInfo = { name: "Best Ball", hcp_allowance: 100, hcp_allowance_secondary: null };
const shamble: FormatInfo  = { name: "Shamble",   hcp_allowance: 70,  hcp_allowance_secondary: null };
const singles: FormatInfo  = { name: "Singles",   hcp_allowance: 100, hcp_allowance_secondary: null };
const pinehurst: FormatInfo = { name: "Pinehurst", hcp_allowance: 50, hcp_allowance_secondary: null };

// A front nine: par + stroke index (18-hole SIs, as stored on the course)
const front9: HoleInfo[] = [
  [1, 4, 7], [2, 5, 3], [3, 3, 15], [4, 4, 1], [5, 4, 11],
  [6, 3, 17], [7, 5, 5], [8, 4, 9], [9, 4, 13],
].map(([hole_number, par, stroke_index]) => ({ hole_number, par, stroke_index }));

const g = (hp1: number | null, hp2: number | null, ap1: number | null, ap2: number | null): GrossScores =>
  ({ home_p1_gross: hp1, home_p2_gross: hp2, away_p1_gross: ap1, away_p2_gross: ap2 });

/** Replay scores hole by hole, returning the running outcome after each entry. */
function play(fmt: FormatInfo, ch: Parameters<typeof computePlayingHcps>[1], entries: [number, GrossScores][]) {
  const phcps = computePlayingHcps(fmt, ch, true);
  const scores: Record<number, GrossScores> = {};
  return entries.map(([hole, s]) => {
    scores[hole] = s;
    return matchOutcome(computeHoleResults(fmt, phcps, scores, front9, true), front9.length);
  });
}

describe("live scoring — a full Best Ball nine, hole by hole", () => {
  // Everyone scratch-equal so gross decides, keeping the expected line obvious.
  const even = { homeP1: 10, homeP2: 10, awayP1: 10, awayP2: 10 };
  const timeline = play(bestBall, even, [
    [1, g(4, 5, 4, 5)],  // halve           AS
    [2, g(4, 6, 5, 5)],  // home            H 1up
    [3, g(3, 3, 2, 4)],  // away            AS
    [4, g(4, 4, 5, 5)],  // home            H 1up
    [5, g(4, 5, 5, 6)],  // home            H 2up
    [6, g(3, 3, 3, 3)],  // halve           H 2up
    [7, g(4, 6, 5, 5)],  // home            H 3up with 2 to play → 3&2
  ]);

  it("tracks the running margin", () => {
    expect(timeline.map((o) => o.homeWon - o.awayWon)).toEqual([0, 1, 0, 1, 2, 2, 3]);
  });

  it("is undecided until the lead exceeds the holes left", () => {
    expect(timeline.slice(0, 6).every((o) => !o.decided)).toBe(true);
  });

  it("closes out 3&2 the moment it's mathematically over", () => {
    const last = timeline[timeline.length - 1];
    expect(last).toMatchObject({ decided: true, result: "home", score: "3&2" });
  });
});

describe("live scoring — scores arriving the messy way phones send them", () => {
  const even = { homeP1: 10, homeP2: 10, awayP1: 10, awayP2: 10 };

  it("a hole with only one side entered decides nothing", () => {
    const [o] = play(bestBall, even, [[1, g(4, null, null, null)]]);
    expect(o.holesPlayed).toBe(0);
    expect(o.result).toBeNull();
  });

  it("one ball per side is enough to score a best-ball hole", () => {
    const [o] = play(bestBall, even, [[1, g(null, 4, 5, null)]]);
    expect(o.holesPlayed).toBe(1);
    expect(o.homeWon).toBe(1);
  });

  it("a skipped hole doesn't shift the closeout math", () => {
    // Hole 2 never entered; home wins 1,3,4,5,6 → 5 up with 3 scored-holes left
    const out = play(bestBall, even, [
      [1, g(3, 5, 4, 5)], [3, g(2, 5, 3, 5)], [4, g(3, 5, 4, 5)],
      [5, g(3, 5, 4, 5)], [6, g(2, 5, 3, 5)],
    ]);
    expect(out[out.length - 1]).toMatchObject({ decided: true, result: "home", score: "5&4" });
  });

  it("correcting a score re-decides the hole", () => {
    const out = play(bestBall, even, [[1, g(4, 5, 5, 5)], [1, g(4, 5, 3, 5)]]);
    expect(out[0].homeWon).toBe(1);
    expect(out[1]).toMatchObject({ homeWon: 0, awayWon: 1 });
  });

  it("goes the distance: all square after nine is a halved match", () => {
    const entries = front9.map((h, i): [number, GrossScores] =>
      [h.hole_number, i % 2 === 0 ? g(4, 5, 5, 5) : g(5, 5, 4, 5)]);
    entries[8] = [9, g(4, 4, 4, 4)]; // 4 each, then a halve on 9
    const last = play(bestBall, even, entries).pop()!;
    expect(last).toMatchObject({ decided: true, result: "halve", score: "Halved" });
  });
});

describe("live scoring — strokes actually change who wins the hole", () => {
  it("Singles: the higher handicap wins a hole he ties gross, where he gets a stroke", () => {
    // 9-hole: 10 vs 2 → 5 vs 1 → plays 4 vs 0: strokes on the 4 hardest of these nine
    const ch = { homeP1: 2, homeP2: null, awayP1: 10, awayP2: null };
    const phcps = computePlayingHcps(singles, ch, true);
    expect(phcps).toMatchObject({ homeP1: 0, awayP1: 4 });
    const res = computeHoleResults(singles, phcps, {
      4: g(4, null, 4, null), // SI 1  → away strokes → away wins the tie
      6: g(3, null, 3, null), // SI 17 → no stroke    → halve
    }, front9, true);
    expect(res[3]).toBe("away");
    expect(res[5]).toBe("halve");
  });

  it("Pinehurst is one score per side and uses the TEAM handicap", () => {
    const ch = { homeP1: 4, homeP2: 8, awayP1: 12, awayP2: 20 };
    const phcps = computePlayingHcps(pinehurst, ch, true);
    expect(phcps.homeTeam).toBe(0);
    expect(phcps.awayTeam).toBeGreaterThan(0);
    const res = computeHoleResults(pinehurst, phcps, { 4: g(4, null, 5, null) }, front9, true);
    expect(res[3]).toBe("halve"); // 5 net 4 on the #1 handicap hole
  });

  it("a per-match format override changes strokes for THAT match only", () => {
    const ch = { homeP1: 4, homeP2: 10, awayP1: 24, awayP2: null }; // the 3-man group
    const roundDefault = computePlayingHcps(effectiveFormat(null, bestBall)!, ch, true);
    const overridden   = computePlayingHcps(effectiveFormat(shamble, bestBall)!, ch, true);
    expect(overridden.awayP1).toBeLessThan(roundDefault.awayP1);
  });
});

describe("betting — a week of action nets to zero", () => {
  const p = (player_id: string, is_winner: boolean | null) => ({ player_id, is_winner });
  const week: BetForNet[] = [
    { status: "closed", amount: 20, bet_participants: [p("kyle", true), p("shoops", false)] },
    { status: "closed", amount: 10, bet_participants: [p("kyle", false), p("joey", false), p("ross", true), p("lars", true)] },
    // CTP posted to the ledger: 8-man group, $5 a head, one holder
    { status: "closed", amount: 5,  bet_participants: ["kyle", "shoops", "joey", "ross", "lars", "jc", "zach", "sam"].map((id) => p(id, id === "jc")) },
    { status: "push",      amount: 50, bet_participants: [p("kyle", null), p("ross", null)] },
    { status: "protested", amount: 40, bet_participants: [p("joey", true), p("lars", false)] }, // frozen
    { status: "void",      amount: 25, bet_participants: [p("zach", true), p("sam", false)] },
    { status: "active",    amount: 15, bet_participants: [p("sam", null), p("jc", null)] },
  ];
  const ledger = ledgerNets(week);

  it("the ledger always sums to exactly zero", () => {
    const total = Array.from(ledger.values()).reduce((a, b) => a + b, 0);
    expect(total).toBe(0);
  });

  it("only settled bets move money — protested, void, push and open are frozen", () => {
    expect(ledger.get("kyle")).toBe(20 - 10 - 5);
    expect(ledger.get("jc")).toBe(7 * 5);
    expect(ledger.get("joey")).toBe(-10 - 5);   // the protested +40 is NOT counted
    expect(ledger.get("zach")).toBe(-5);        // the voided +25 is NOT counted
  });

  it("a half-settled bet (no winner recorded) moves nothing rather than charging everyone", () => {
    const nets = betNets({ status: "closed", amount: 20, bet_participants: [p("a", null), p("b", null)] });
    expect(Array.from(nets.values())).toEqual([0, 0]);
  });

  it("odd splits still net to zero (3 losers paying 2 winners)", () => {
    const nets = betNets({ status: "closed", amount: 10, bet_participants: [p("a", true), p("b", true), p("c", false), p("d", false), p("e", false)] });
    expect(Array.from(nets.values()).reduce((x, y) => x + y, 0)).toBe(0);
    expect(nets.get("a")).toBe(15);
  });
});
