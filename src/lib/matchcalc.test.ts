import { describe, it, expect } from "vitest";
import {
  computePlayingHcps,
  computeHoleResults,
  effectiveFormat,
  type FormatInfo,
  type HoleInfo,
} from "./matchcalc";

const singles: FormatInfo  = { name: "Singles",   hcp_allowance: 100, hcp_allowance_secondary: null };
const bestBall: FormatInfo = { name: "Best Ball", hcp_allowance: 100, hcp_allowance_secondary: null };
const scramble: FormatInfo = { name: "Scramble",  hcp_allowance: 35,  hcp_allowance_secondary: 15 };

describe("computePlayingHcps", () => {
  it("Singles: normalizes to the lower player", () => {
    const p = computePlayingHcps(singles, { homeP1: 11, homeP2: null, awayP1: 16, awayP2: null }, false);
    expect(p.homeP1).toBe(0);
    expect(p.awayP1).toBe(5);
    expect(p.homeTeam).toBeNull();
  });

  it("Best Ball 9-hole: matches the Stribos/Ross vs Kyle/Zach card", () => {
    // course 14, 27 vs 11, 33 → halved: 7, 13.5, 5.5, 16.5 → lowest 5.5
    const p = computePlayingHcps(bestBall, { homeP1: 14, homeP2: 27, awayP1: 11, awayP2: 33 }, true);
    expect(p.homeP1).toBe(1.5);
    expect(p.homeP2).toBe(8);
    expect(p.awayP1).toBe(0);
    expect(p.awayP2).toBe(11);
  });

  it("Scramble 9-hole: matches the Joey/Lars vs Kyle/Shoops card", () => {
    // Joey 16 low 35% = 3, Lars 31 high 15% = 2.5 → team 5.5
    // Kyle 11 low 35% = 2, Shoops 13 high 15% = 1 → team 3 → normalized 2.5 / 0
    const p = computePlayingHcps(scramble, { homeP1: 16, homeP2: 31, awayP1: 11, awayP2: 13 }, true);
    expect(p.homeTeam).toBe(2.5);
    expect(p.awayTeam).toBe(0);
    expect(p.homeP1).toBe(0); // individual slots unused for one-score formats
  });

  it("Scramble 2v1: solo side gets 50% of own", () => {
    const p = computePlayingHcps(scramble, { homeP1: 16, homeP2: 31, awayP1: 12, awayP2: null }, true);
    // home team: 3 + 2.5 = 5.5; away solo: (12/2) × 50% = 3 → normalized 2.5 / 0
    expect(p.homeTeam).toBe(2.5);
    expect(p.awayTeam).toBe(0);
  });
});

describe("computeHoleResults", () => {
  const holes: HoleInfo[] = [
    { hole_number: 1, par: 4, stroke_index: 7 },
    { hole_number: 2, par: 5, stroke_index: 11 },
    { hole_number: 3, par: 3, stroke_index: 17 },
    { hole_number: 4, par: 4, stroke_index: 1 },
    { hole_number: 5, par: 4, stroke_index: 5 },
    { hole_number: 6, par: 4, stroke_index: 13 },
    { hole_number: 7, par: 3, stroke_index: 15 },
    { hole_number: 8, par: 4, stroke_index: 3 },
    { hole_number: 9, par: 5, stroke_index: 9 },
  ];

  it("Scramble: reproduces the Match 1 card (Europe 4, USA 3, 2 halves)", () => {
    const phcps = computePlayingHcps(scramble, { homeP1: 16, homeP2: 31, awayP1: 11, awayP2: 13 }, true);
    // Europe (home) team 2.5: full strokes on SI-rank 1 (hole 4, SI 1) and
    // SI-rank 2 (hole 8, SI 3), half on SI-rank 3 (hole 5, SI 5).
    const gross = (h: number | null, a: number | null) => ({
      home_p1_gross: h, home_p2_gross: null, away_p1_gross: a, away_p2_gross: null,
    });
    const scoreMap = {
      1: gross(4, 5), 2: gross(5, 4), 3: gross(3, 3),
      4: gross(5, 4), 5: gross(5, 4), 6: gross(3, 4),
      7: gross(3, 4), 8: gross(4, 4), 9: gross(6, 5),
    };
    const results = computeHoleResults(scramble, phcps, scoreMap, holes, true);
    expect(results).toEqual([
      "home", "away", "halve", "halve", "away", "home", "home", "home", "away",
    ]);
  });

  it("returns null for unscored holes", () => {
    const phcps = computePlayingHcps(singles, { homeP1: 10, homeP2: null, awayP1: 12, awayP2: null }, false);
    const results = computeHoleResults(singles, phcps, {}, holes, false);
    expect(results).toEqual(Array(9).fill(null));
  });
});

describe("effectiveFormat", () => {
  const shamble: FormatInfo = { name: "Shamble", hcp_allowance: 70, hcp_allowance_secondary: null };

  it("uses the round format when the match has no override", () => {
    expect(effectiveFormat(null, shamble)).toBe(shamble);
    expect(effectiveFormat(undefined, shamble)).toBe(shamble);
  });

  it("uses the match override when set", () => {
    expect(effectiveFormat(bestBall, shamble)).toBe(bestBall);
  });

  it("is null when neither is set", () => {
    expect(effectiveFormat(null, null)).toBeNull();
  });

  it("changes the strokes a 2v1 group gets — the 3-man Shamble case", () => {
    // Round is Best Ball (100%); the short group agreed to Shamble (70%).
    const ch = { homeP1: 10, homeP2: 20, awayP1: 30, awayP2: null };
    const asRound = computePlayingHcps(effectiveFormat(null, bestBall)!, ch, false);
    const asMatch = computePlayingHcps(effectiveFormat(shamble, bestBall)!, ch, false);
    expect(asRound.awayP1).toBe(20);  // 30-10 at 100%
    expect(asMatch.awayP1).toBe(14);  // (21-7) at 70%
  });
});
