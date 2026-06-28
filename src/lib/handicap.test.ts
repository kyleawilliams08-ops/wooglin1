import { describe, it, expect } from "vitest";
import {
  courseHandicap,
  playingHandicap,
  strokesOnHole,
  netScore,
  scrambleHandicaps,
  partnerHandicaps,
  singlesHandicaps,
} from "./handicap";

const midPinesBlue: { rating: number; slope: number; par: number } = { rating: 72.9, slope: 138, par: 72 };
const tobaccoRoadDisc: { rating: number; slope: number; par: number } = { rating: 70.3, slope: 135, par: 71 };

// ---------------------------------------------------------------------------
// courseHandicap
// ---------------------------------------------------------------------------
describe("courseHandicap", () => {
  it("calculates correctly for a scratch golfer", () => {
    // 0 * (138/113) + (72.9 - 72) = 0.9 → rounds to 1
    expect(courseHandicap(0, midPinesBlue)).toBe(1);
  });

  it("calculates for an 8.0 index at Mid Pines Blue", () => {
    // 8.0 * (138/113) + (72.9 - 72) = 9.77 + 0.9 = 10.67 → 11
    expect(courseHandicap(8.0, midPinesBlue)).toBe(11);
  });

  it("calculates for a 14.7 index at Mid Pines Blue", () => {
    // 14.7 * (138/113) + 0.9 = 17.95 + 0.9 = 18.85 → 19
    expect(courseHandicap(14.7, midPinesBlue)).toBe(19);
  });

  it("calculates for a 10.5 index at Tobacco Road Disc", () => {
    // 10.5 * (135/113) + (70.3 - 71) = 12.54 - 0.7 = 11.84 → 12
    expect(courseHandicap(10.5, tobaccoRoadDisc)).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// playingHandicap
// ---------------------------------------------------------------------------
describe("playingHandicap", () => {
  it("returns full handicap at 100%", () => {
    expect(playingHandicap(11, 100)).toBe(11);
  });

  it("applies 70% for Shamble (floors)", () => {
    // 11 * 0.70 = 7.7 → floor → 7
    expect(playingHandicap(11, 70)).toBe(7);
  });

  it("applies 50% for Pinehurst", () => {
    expect(playingHandicap(11, 50)).toBe(5);
  });

  it("applies 35% (low) and 15% (high) for Scramble", () => {
    expect(playingHandicap(11, 35)).toBe(3);
    expect(playingHandicap(19, 15)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// strokesOnHole
// ---------------------------------------------------------------------------
describe("strokesOnHole", () => {
  it("gives no stroke when handicap is 0", () => {
    expect(strokesOnHole(0, 1)).toBe(0);
  });

  it("gives a stroke on SI 1 for a 1-hcp player", () => {
    expect(strokesOnHole(1, 1)).toBe(1);
  });

  it("gives no stroke on SI 2 for a 1-hcp player", () => {
    expect(strokesOnHole(1, 2)).toBe(0);
  });

  it("gives strokes on all 18 holes for an 18-hcp player", () => {
    for (let si = 1; si <= 18; si++) {
      expect(strokesOnHole(18, si)).toBe(1);
    }
  });

  it("gives 2 strokes on SI 1 for a 19-hcp player", () => {
    expect(strokesOnHole(19, 1)).toBe(2);
  });

  it("gives 1 stroke on SI 2-18 for a 19-hcp player", () => {
    for (let si = 2; si <= 18; si++) {
      expect(strokesOnHole(19, si)).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// netScore
// ---------------------------------------------------------------------------
describe("netScore", () => {
  it("subtracts strokes received", () => {
    // 7-hcp player, SI 3 → gets a stroke → net = 5 - 1 = 4
    expect(netScore(5, 7, 3)).toBe(4);
  });

  it("no stroke on a hole outside handicap range", () => {
    // 7-hcp player, SI 10 → no stroke → net = 5
    expect(netScore(5, 7, 10)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// scrambleHandicaps
// ---------------------------------------------------------------------------
describe("scrambleHandicaps", () => {
  const scrambleFormat = { hcp_allowance: 35, hcp_allowance_secondary: 15 };

  it("assigns low/high correctly regardless of argument order", () => {
    const r1 = scrambleHandicaps(8.0, 14.7, midPinesBlue, scrambleFormat);
    const r2 = scrambleHandicaps(14.7, 8.0, midPinesBlue, scrambleFormat);
    expect(r1).toEqual(r2);
  });

  it("low player gets 35% allowance", () => {
    // 8.0 → courseHcp 11 → 11 * 0.35 = 3.85 → floor 3
    const { lowPlayingHcp } = scrambleHandicaps(8.0, 14.7, midPinesBlue, scrambleFormat);
    expect(lowPlayingHcp).toBe(3);
  });

  it("high player gets 15% allowance", () => {
    // 14.7 → courseHcp 19 → 19 * 0.15 = 2.85 → floor 2
    const { highPlayingHcp } = scrambleHandicaps(8.0, 14.7, midPinesBlue, scrambleFormat);
    expect(highPlayingHcp).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// singlesHandicaps
// ---------------------------------------------------------------------------
describe("singlesHandicaps", () => {
  const singlesFormat = { hcp_allowance: 100 };

  it("lower hcp player receives 0 strokes", () => {
    const { hcpA } = singlesHandicaps(8.0, 14.7, midPinesBlue, singlesFormat);
    expect(hcpA).toBe(0);
  });

  it("higher hcp player receives the difference", () => {
    // 8.0 → 11, 14.7 → 19, diff = 8
    const { hcpB } = singlesHandicaps(8.0, 14.7, midPinesBlue, singlesFormat);
    expect(hcpB).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// partnerHandicaps
// ---------------------------------------------------------------------------
describe("partnerHandicaps", () => {
  it("both players get 70% allowance for Shamble", () => {
    const shamble = { hcp_allowance: 70 };
    const { hcpA, hcpB } = partnerHandicaps(8.0, 14.7, midPinesBlue, shamble);
    // 8.0 → 11 → floor(11 * 0.70) = 7
    // 14.7 → 19 → floor(19 * 0.70) = 13
    expect(hcpA).toBe(7);
    expect(hcpB).toBe(13);
  });
});
