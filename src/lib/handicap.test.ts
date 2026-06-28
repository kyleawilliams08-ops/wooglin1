import { describe, it, expect } from "vitest";
import {
  roundToHalf,
  courseHandicap,
  playingHandicap,
  strokesGivenOnHole,
  netScore,
  scrambleHandicaps,
  partnerHandicaps,
  singlesHandicaps,
} from "./handicap";

const midPinesBlue: { rating: number; slope: number; par: number } = { rating: 72.9, slope: 138, par: 72 };
const tobaccoRoadDisc: { rating: number; slope: number; par: number } = { rating: 70.3, slope: 135, par: 71 };

// ---------------------------------------------------------------------------
// roundToHalf
// ---------------------------------------------------------------------------
describe("roundToHalf", () => {
  it("rounds 4.25 up to 4.5 (tie rounds up)", () => expect(roundToHalf(4.25)).toBe(4.5));
  it("rounds 7.75 up to 8.0 (tie rounds up)",  () => expect(roundToHalf(7.75)).toBe(8.0));
  it("rounds 7.4 down to 7.5",  () => expect(roundToHalf(7.4)).toBe(7.5));
  it("rounds 7.6 up to 7.5",    () => expect(roundToHalf(7.6)).toBe(7.5));
  it("rounds 7.9 up to 8.0",    () => expect(roundToHalf(7.9)).toBe(8.0));
  it("leaves exact halves alone", () => {
    expect(roundToHalf(5.0)).toBe(5.0);
    expect(roundToHalf(5.5)).toBe(5.5);
  });
});

// ---------------------------------------------------------------------------
// courseHandicap
// ---------------------------------------------------------------------------
describe("courseHandicap", () => {
  it("calculates for a scratch golfer at Mid Pines Blue", () => {
    // 0 * (138/113) + (72.9 - 72) = 0.9 → rounds to 1
    expect(courseHandicap(0, midPinesBlue)).toBe(1);
  });

  it("calculates for an 8.0 index at Mid Pines Blue", () => {
    // 8.0 * (138/113) + 0.9 ≈ 10.67 → 11
    expect(courseHandicap(8.0, midPinesBlue)).toBe(11);
  });

  it("calculates for a 14.7 index at Mid Pines Blue", () => {
    // 14.7 * (138/113) + 0.9 ≈ 18.85 → 19
    expect(courseHandicap(14.7, midPinesBlue)).toBe(19);
  });

  it("calculates for a 10.5 index at Tobacco Road Disc", () => {
    // 10.5 * (135/113) + (70.3 - 71) ≈ 11.84 → 12
    expect(courseHandicap(10.5, tobaccoRoadDisc)).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// playingHandicap — full 18
// ---------------------------------------------------------------------------
describe("playingHandicap (full 18)", () => {
  it("returns full handicap rounded to 0.5 at 100%", () => {
    // 11 * 1.0 = 11.0 → 11.0
    expect(playingHandicap(11, 100)).toBe(11.0);
  });

  it("applies 70% for Shamble and rounds to nearest 0.5", () => {
    // 11 * 0.70 = 7.7 → nearest 0.5 = 7.5
    expect(playingHandicap(11, 70)).toBe(7.5);
  });

  it("applies 50% for Pinehurst", () => {
    // 11 * 0.50 = 5.5 → 5.5
    expect(playingHandicap(11, 50)).toBe(5.5);
  });

  it("applies 35% (low) for Scramble", () => {
    // 11 * 0.35 = 3.85 → nearest 0.5 = 4.0
    expect(playingHandicap(11, 35)).toBe(4.0);
  });

  it("applies 15% (high) for Scramble", () => {
    // 19 * 0.15 = 2.85 → nearest 0.5 = 3.0
    expect(playingHandicap(19, 15)).toBe(3.0);
  });
});

// ---------------------------------------------------------------------------
// playingHandicap — 9-hole halving
// ---------------------------------------------------------------------------
describe("playingHandicap (9-hole)", () => {
  it("halves course hcp before applying allowance", () => {
    // courseHcp=11, 9-hole → 5.5, × 70% = 3.85 → nearest 0.5 = 4.0
    expect(playingHandicap(11, 70, true)).toBe(4.0);
  });

  it("halves then rounds at the end, not in the middle", () => {
    // courseHcp=19, 9-hole → 9.5, × 100% = 9.5 → 9.5
    expect(playingHandicap(19, 100, true)).toBe(9.5);
  });

  it("9-hole singles at 100% allowance", () => {
    // courseHcp=11, 9-hole → 5.5, × 100% = 5.5 → 5.5
    expect(playingHandicap(11, 100, true)).toBe(5.5);
  });
});

// ---------------------------------------------------------------------------
// strokesGivenOnHole
// ---------------------------------------------------------------------------
describe("strokesGivenOnHole", () => {
  it("gives no stroke when handicap is 0", () => {
    expect(strokesGivenOnHole(0, 1)).toBe(0);
  });

  it("gives a stroke on SI 1 for a 1-hcp player", () => {
    expect(strokesGivenOnHole(1, 1)).toBe(1);
  });

  it("gives no stroke on SI 2 for a 1-hcp player", () => {
    expect(strokesGivenOnHole(1, 2)).toBe(0);
  });

  it("gives 1 stroke on every hole for an 18-hcp player", () => {
    for (let si = 1; si <= 18; si++) {
      expect(strokesGivenOnHole(18, si)).toBe(1);
    }
  });

  it("gives 2 strokes on SI 1 for a 19-hcp player", () => {
    expect(strokesGivenOnHole(19, 1)).toBe(2);
  });

  it("gives 1 stroke on SI 2–18 for a 19-hcp player", () => {
    for (let si = 2; si <= 18; si++) {
      expect(strokesGivenOnHole(19, si)).toBe(1);
    }
  });

  it("handles half-point handicaps (rounds down for stroke allocation)", () => {
    // 7.5 hcp: full strokes = 0, extra = 7.5 — SI ≤ 7 gets a stroke (floor behavior)
    // Math.floor(7.5) = 7, so holes SI 1–7 get a stroke
    expect(strokesGivenOnHole(7.5, 7)).toBe(1);
    expect(strokesGivenOnHole(7.5, 8)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// netScore
// ---------------------------------------------------------------------------
describe("netScore", () => {
  it("subtracts strokes received", () => {
    // 7-hcp player, SI 3 → 1 stroke → net = 5 - 1 = 4
    expect(netScore(5, 7, 3)).toBe(4);
  });

  it("no stroke outside handicap range", () => {
    // 7-hcp player, SI 10 → no stroke
    expect(netScore(5, 7, 10)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// scrambleHandicaps
// ---------------------------------------------------------------------------
describe("scrambleHandicaps", () => {
  const scramble = { hcp_allowance: 35, hcp_allowance_secondary: 15 };

  it("assigns low/high correctly regardless of argument order", () => {
    expect(scrambleHandicaps(8.0, 14.7, midPinesBlue, scramble))
      .toEqual(scrambleHandicaps(14.7, 8.0, midPinesBlue, scramble));
  });

  it("low player gets 35% allowance rounded to 0.5", () => {
    // 8.0 → courseHcp 11 → 11 * 0.35 = 3.85 → 4.0
    expect(scrambleHandicaps(8.0, 14.7, midPinesBlue, scramble).lowPlayingHcp).toBe(4.0);
  });

  it("high player gets 15% allowance rounded to 0.5", () => {
    // 14.7 → courseHcp 19 → 19 * 0.15 = 2.85 → 3.0
    expect(scrambleHandicaps(8.0, 14.7, midPinesBlue, scramble).highPlayingHcp).toBe(3.0);
  });

  it("applies 9-hole halving when nineHole=true", () => {
    const r = scrambleHandicaps(8.0, 14.7, midPinesBlue, scramble, true);
    // 11/2=5.5 × 35% = 1.925 → 2.0
    expect(r.lowPlayingHcp).toBe(2.0);
  });
});

// ---------------------------------------------------------------------------
// singlesHandicaps
// ---------------------------------------------------------------------------
describe("singlesHandicaps", () => {
  const singles = { hcp_allowance: 100 };

  it("lower-hcp player receives 0 strokes", () => {
    expect(singlesHandicaps(8.0, 14.7, midPinesBlue, singles).hcpA).toBe(0);
  });

  it("higher-hcp player receives the difference", () => {
    // 8.0 → 11, 14.7 → 19, diff = 8
    expect(singlesHandicaps(8.0, 14.7, midPinesBlue, singles).hcpB).toBe(8);
  });

  it("9-hole singles also differences correctly", () => {
    // 8.0: 11/2=5.5×100%=5.5  |  14.7: 19/2=9.5×100%=9.5  →  diff=4.0
    const r = singlesHandicaps(8.0, 14.7, midPinesBlue, singles, true);
    expect(r.hcpA).toBe(0);
    expect(r.hcpB).toBe(4.0);
  });
});

// ---------------------------------------------------------------------------
// partnerHandicaps
// ---------------------------------------------------------------------------
describe("partnerHandicaps", () => {
  it("both players get 70% Shamble allowance rounded to 0.5", () => {
    const shamble = { hcp_allowance: 70 };
    const { hcpA, hcpB } = partnerHandicaps(8.0, 14.7, midPinesBlue, shamble);
    // 8.0 → 11 × 0.70 = 7.7 → 7.5
    // 14.7 → 19 × 0.70 = 13.3 → 13.5
    expect(hcpA).toBe(7.5);
    expect(hcpB).toBe(13.5);
  });

  it("applies 9-hole halving for Shamble", () => {
    const shamble = { hcp_allowance: 70 };
    const { hcpA } = partnerHandicaps(8.0, 14.7, midPinesBlue, shamble, true);
    // 11/2=5.5 × 0.70 = 3.85 → 4.0
    expect(hcpA).toBe(4.0);
  });
});
