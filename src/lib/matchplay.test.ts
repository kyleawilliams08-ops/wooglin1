import { describe, it, expect } from "vitest";
import { matchOutcome, outcomeBadge, type HoleResult } from "./matchplay";

const H: HoleResult = "home";
const A: HoleResult = "away";
const S: HoleResult = "halve"; // squared/halved hole

describe("matchOutcome", () => {
  it("closes out early: 2 up with 1 to play over 9 holes = 2&1", () => {
    // Europe(home) wins holes 1,6,7,8; USA(away) wins 2,5,9; 3,4 halved.
    const results = [H, A, S, S, A, H, H, H, A];
    const o = matchOutcome(results, 9);
    expect(o.result).toBe("home");
    expect(o.decided).toBe(true);
    expect(o.score).toBe("2&1");
    // Only the first 8 holes count toward the decision.
    expect(o.holesPlayed).toBe(8);
    expect(outcomeBadge(o, "Europe", "USA")).toBe("Europe wins 2&1");
  });

  it("won on the final hole reports '1 up', not X&0", () => {
    const results = [H, A, S, S, A, S, H, S, H]; // ends home +1 after 9
    const o = matchOutcome(results, 9);
    expect(o.decided).toBe(true);
    expect(o.result).toBe("home");
    expect(o.score).toBe("1 up");
    expect(outcomeBadge(o, "Europe", "USA")).toBe("Europe wins 1 up");
  });

  it("all holes halved is a decided halve", () => {
    const o = matchOutcome([S, S, S, S, S, S, S, S, S], 9);
    expect(o.result).toBe("halve");
    expect(o.decided).toBe(true);
    expect(o.score).toBe("Halved");
    expect(outcomeBadge(o, "Europe", "USA")).toBe("Halved");
  });

  it("in-progress lead is not decided and shows holes to play", () => {
    // 5 holes played, home +1, 4 to play.
    const results: HoleResult[] = [H, A, S, S, H, null, null, null, null];
    const o = matchOutcome(results, 9);
    expect(o.decided).toBe(false);
    expect(o.result).toBe("home");
    expect(o.score).toBe("1 up");
    expect(o.remaining).toBe(4);
    expect(outcomeBadge(o, "Europe", "USA")).toBe("Europe 1 up (4 to play)");
  });

  it("no scores yet returns a null result", () => {
    const o = matchOutcome([null, null, null, null, null, null, null, null, null], 9);
    expect(o.result).toBeNull();
    expect(o.score).toBeNull();
    expect(outcomeBadge(o, "Europe", "USA")).toBeNull();
  });

  it("18-hole closeout: 4&3", () => {
    // home reaches +4 after hole 15 (3 to play).
    const results: HoleResult[] = [
      H, H, S, H, S, S, S, S, S, S, S, S, S, S, H, null, null, null,
    ];
    const o = matchOutcome(results, 18);
    expect(o.result).toBe("home");
    expect(o.decided).toBe(true);
    expect(o.score).toBe("4&3");
  });
});
