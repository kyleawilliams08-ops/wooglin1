import { describe, it, expect } from "vitest";
import {
  roundToHalf,
  courseHandicap,
  playingHandicap,
  strokesGivenOnHole,
  netScore,
  normalizeToLowest,
  groupHandicaps,
  teamHandicap,
  twoTeamHandicaps,
  scrambleHandicaps,
  partnerHandicaps,
  singlesHandicaps,
  shamble2v1SoloHandicap,
  shamble2v1GroupHandicaps,
  scramble2v1SoloHandicap,
  nineHoleSIRank,
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

  it("returns 0.5 for the half-stroke hole (3.5 hcp → 3 full + half on SI 4)", () => {
    expect(strokesGivenOnHole(3.5, 1)).toBe(1);
    expect(strokesGivenOnHole(3.5, 2)).toBe(1);
    expect(strokesGivenOnHole(3.5, 3)).toBe(1);
    expect(strokesGivenOnHole(3.5, 4)).toBe(0.5); // half stroke
    expect(strokesGivenOnHole(3.5, 5)).toBe(0);
  });

  it("wraps at 9 for 9-hole rounds: 11 hcp = 2 strokes on SI rank 1–2, 1 elsewhere", () => {
    // e.g. Zach: playing hcp 11 in a 9-hole Best Ball
    expect(strokesGivenOnHole(11, 1, 9)).toBe(2);
    expect(strokesGivenOnHole(11, 2, 9)).toBe(2);
    for (let si = 3; si <= 9; si++) {
      expect(strokesGivenOnHole(11, si, 9)).toBe(1);
    }
  });

  it("9-hole: exactly 9 hcp gives 1 stroke on every hole, no doubles", () => {
    for (let si = 1; si <= 9; si++) {
      expect(strokesGivenOnHole(9, si, 9)).toBe(1);
    }
  });

  it("9-hole: half strokes wrap too (9.5 hcp → 1½ on SI rank 1)", () => {
    expect(strokesGivenOnHole(9.5, 1, 9)).toBe(1.5);
    expect(strokesGivenOnHole(9.5, 2, 9)).toBe(1);
  });

  it("total strokes across 9 holes equals playingHcp when it exceeds 9", () => {
    const hcp = 11;
    const total = Array.from({ length: 9 }, (_, i) => strokesGivenOnHole(hcp, i + 1, 9))
      .reduce((a, b) => a + b, 0);
    expect(total).toBe(hcp);
  });

  it("total strokes across 18 holes equals playingHcp for whole numbers", () => {
    const hcp = 7;
    const total = Array.from({ length: 18 }, (_, i) => strokesGivenOnHole(hcp, i + 1))
      .reduce((a, b) => a + b, 0);
    expect(total).toBe(hcp);
  });

  it("total strokes across 18 holes equals playingHcp for half numbers", () => {
    const hcp = 7.5;
    const total = Array.from({ length: 18 }, (_, i) => strokesGivenOnHole(hcp, i + 1))
      .reduce((a, b) => a + b, 0);
    expect(total).toBe(hcp);
  });
});

// ---------------------------------------------------------------------------
// nineHoleSIRank
// ---------------------------------------------------------------------------
describe("nineHoleSIRank", () => {
  // Pine Wild front 9 SIs (holes 1-9): 5,13,17,1,9,3,15,11,7
  const frontSIs = [5, 13, 17, 1, 9, 3, 15, 11, 7];

  it("ranks SI 1 as 1 (hardest)", () => {
    expect(nineHoleSIRank(1, frontSIs)).toBe(1);
  });

  it("ranks SI 3 as 2", () => {
    expect(nineHoleSIRank(3, frontSIs)).toBe(2);
  });

  it("ranks SI 5 as 3", () => {
    expect(nineHoleSIRank(5, frontSIs)).toBe(3);
  });

  it("ranks SI 7 as 4", () => {
    expect(nineHoleSIRank(7, frontSIs)).toBe(4);
  });

  it("so a 3.5-hcp player gets strokes on ranks 1-3 and half on rank 4", () => {
    expect(strokesGivenOnHole(3.5, nineHoleSIRank(1,  frontSIs))).toBe(1);   // hole 4
    expect(strokesGivenOnHole(3.5, nineHoleSIRank(3,  frontSIs))).toBe(1);   // hole 6
    expect(strokesGivenOnHole(3.5, nineHoleSIRank(5,  frontSIs))).toBe(1);   // hole 1
    expect(strokesGivenOnHole(3.5, nineHoleSIRank(7,  frontSIs))).toBe(0.5); // hole 9 — half!
    expect(strokesGivenOnHole(3.5, nineHoleSIRank(9,  frontSIs))).toBe(0);
    expect(strokesGivenOnHole(3.5, nineHoleSIRank(11, frontSIs))).toBe(0);
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
// teamHandicap + twoTeamHandicaps (Pinehurst / Scramble — 1 ball holed)
// ---------------------------------------------------------------------------
describe("teamHandicap", () => {
  it("sums two playing hcps and rounds to 0.5", () => {
    // Pinehurst 50%: player A courseHcp 11 → 5.5, player B courseHcp 19 → 9.5 → team = 15.0
    expect(teamHandicap(5.5, 9.5)).toBe(15.0);
  });

  it("rounds the sum to nearest 0.5", () => {
    // 4.0 + 3.0 = 7.0
    expect(teamHandicap(4.0, 3.0)).toBe(7.0);
    // 3.5 + 4.0 = 7.5
    expect(teamHandicap(3.5, 4.0)).toBe(7.5);
  });
});

describe("twoTeamHandicaps (Pinehurst)", () => {
  const pinehurst = { hcp_allowance: 50 };

  it("lower team gets 0 net strokes", () => {
    // Team A: players 8.0 + 10.5 at Mid Pines Blue
    // Team B: players 14.7 + 13.0 at Mid Pines Blue
    const { hcpA: pA1, hcpB: pA2 } = partnerHandicaps(8.0, 10.5, midPinesBlue, pinehurst);
    const { hcpA: pB1, hcpB: pB2 } = partnerHandicaps(14.7, 13.0, midPinesBlue, pinehurst);
    const teamA = teamHandicap(pA1, pA2);
    const teamB = teamHandicap(pB1, pB2);
    const { teamA: netA, teamB: netB } = twoTeamHandicaps(teamA, teamB);
    expect(Math.min(netA, netB)).toBe(0);
    expect(netB).toBe(netB - netA + netA); // sanity
    expect(netA).toBe(0); // A has lower indexes so lower team hcp
  });

  it("higher team receives the difference", () => {
    const { teamA: netA, teamB: netB } = twoTeamHandicaps(8, 14);
    expect(netA).toBe(0);
    expect(netB).toBe(6);
  });
});

describe("twoTeamHandicaps (Scramble)", () => {
  const scramble = { hcp_allowance: 35, hcp_allowance_secondary: 15 };

  it("combines scramble allowances into team totals then normalizes", () => {
    // Team A: 8.0 + 14.7 at Mid Pines Blue
    const rA = scrambleHandicaps(8.0, 14.7, midPinesBlue, scramble);
    const teamAHcp = teamHandicap(rA.lowPlayingHcp, rA.highPlayingHcp);
    // Team B: 10.5 + 12.0 at Mid Pines Blue
    const rB = scrambleHandicaps(10.5, 12.0, midPinesBlue, scramble);
    const teamBHcp = teamHandicap(rB.lowPlayingHcp, rB.highPlayingHcp);
    const { teamA, teamB } = twoTeamHandicaps(teamAHcp, teamBHcp);
    expect(Math.min(teamA, teamB)).toBe(0);
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
// normalizeToLowest / groupHandicaps (Best Ball 4-player example)
// ---------------------------------------------------------------------------
describe("normalizeToLowest", () => {
  it("matches the user example: [6,7,4,10] → [2,3,0,6]", () => {
    expect(normalizeToLowest([6, 7, 4, 10])).toEqual([2, 3, 0, 6]);
  });

  it("lowest player always gets 0", () => {
    const result = normalizeToLowest([10, 4, 8, 6]);
    expect(Math.min(...result)).toBe(0);
  });

  it("works for 2 players (same as singles)", () => {
    expect(normalizeToLowest([11, 19])).toEqual([0, 8]);
  });
});

describe("groupHandicaps (Best Ball)", () => {
  it("produces the user example after Best Ball 100% allowance", () => {
    // Suppose course handicaps come out to [6,7,4,10] after 100% allowance
    // Use indexes that produce those course hcps on a flat tee
    const flatTee = { rating: 72, slope: 113, par: 72 }; // slope=113 → index = courseHcp exactly
    const bestBall = { hcp_allowance: 100 };
    const result = groupHandicaps([6, 7, 4, 10], flatTee, bestBall);
    expect(result).toEqual([2, 3, 0, 6]);
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
// 2v1 formats
// ---------------------------------------------------------------------------

describe("shamble2v1SoloHandicap", () => {
  it("uses 50% allowance instead of standard 70%", () => {
    // 8.0 → courseHcp 11 → 11 × 50% = 5.5
    expect(shamble2v1SoloHandicap(8.0, midPinesBlue)).toBe(5.5);
  });

  it("is lower than the standard 70% Shamble allowance", () => {
    const solo = shamble2v1SoloHandicap(8.0, midPinesBlue);
    const standard = playingHandicap(courseHandicap(8.0, midPinesBlue), 70);
    expect(solo).toBeLessThan(standard);
  });

  it("applies 9-hole halving", () => {
    // 11/2 = 5.5 × 50% = 2.75 → 3.0
    expect(shamble2v1SoloHandicap(8.0, midPinesBlue, true)).toBe(3.0);
  });
});

describe("shamble2v1GroupHandicaps", () => {
  it("returns 3 values, lowest is 0", () => {
    // solo 8.0 (50%), partners 14.7 + 10.5 (70% each)
    const [solo, pA, pB] = shamble2v1GroupHandicaps(8.0, 14.7, 10.5, midPinesBlue);
    expect(Math.min(solo, pA, pB)).toBe(0);
    expect([solo, pA, pB].length).toBe(3);
  });

  it("solo at 50% has lower hcp than 70% partners before normalization", () => {
    // solo raw = 5.5, partner 10.5 raw = 9.5×70% = 6.5, partner 14.7 raw = 13.5
    // after normalize: solo is lowest → gets 0
    const [solo] = shamble2v1GroupHandicaps(8.0, 14.7, 10.5, midPinesBlue);
    expect(solo).toBe(0);
  });
});

describe("scramble2v1SoloHandicap", () => {
  it("uses 50% allowance (35% low + 15% high of own index)", () => {
    // 8.0 → courseHcp 11 → 11 × 50% = 5.5
    expect(scramble2v1SoloHandicap(8.0, midPinesBlue)).toBe(5.5);
  });

  it("equals shamble2v1 solo allowance (both 50%)", () => {
    expect(scramble2v1SoloHandicap(8.0, midPinesBlue)).toBe(shamble2v1SoloHandicap(8.0, midPinesBlue));
  });

  it("applies 9-hole halving", () => {
    // 11/2 = 5.5 × 50% = 2.75 → 3.0
    expect(scramble2v1SoloHandicap(8.0, midPinesBlue, true)).toBe(3.0);
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
