import { describe, it, expect } from "vitest";
import { betNets, ledgerNets, fmtMoney, fmtNet, type BetForNet } from "./bets";

const bet = (
  status: string,
  amount: number,
  parts: [string, boolean | null][],
): BetForNet => ({
  status,
  amount,
  bet_participants: parts.map(([player_id, is_winner]) => ({ player_id, is_winner })),
});

describe("betNets", () => {
  it("1v1: loser pays the stake to the winner", () => {
    const n = betNets(bet("closed", 20, [["kyle", true], ["joeg", false]]));
    expect(n.get("kyle")).toBe(20);
    expect(n.get("joeg")).toBe(-20);
  });

  it("2v2: each loser pays, each winner collects the stake", () => {
    const n = betNets(bet("closed", 20, [
      ["kyle", true], ["joey", true], ["ross", false], ["zach", false],
    ]));
    expect(n.get("kyle")).toBe(20);
    expect(n.get("joey")).toBe(20);
    expect(n.get("ross")).toBe(-20);
    expect(n.get("zach")).toBe(-20);
  });

  it("group: winner takes (N-1) × stake", () => {
    const n = betNets(bet("closed", 10, [
      ["kyle", true], ["a", false], ["b", false], ["c", false], ["d", false],
    ]));
    expect(n.get("kyle")).toBe(40);
    expect(n.get("a")).toBe(-10);
  });

  it("bet totals are always zero-sum", () => {
    const n = betNets(bet("closed", 15, [
      ["a", true], ["b", true], ["c", false], ["d", false], ["e", false],
    ]));
    const sum = Array.from(n.values()).reduce((x, y) => x + y, 0);
    expect(sum).toBeCloseTo(0);
  });

  it("push, void, pending, and active bets move no money", () => {
    for (const status of ["push", "void", "pending", "active"]) {
      const n = betNets(bet(status, 50, [["a", true], ["b", false]]));
      expect(n.get("a")).toBe(0);
      expect(n.get("b")).toBe(0);
    }
  });

  it("closed bet with no winners marked moves no money", () => {
    const n = betNets(bet("closed", 50, [["a", null], ["b", null]]));
    expect(n.get("a")).toBe(0);
  });
});

describe("ledgerNets", () => {
  it("sums nets across bets per player", () => {
    const totals = ledgerNets([
      bet("closed", 20, [["kyle", true], ["joeg", false]]),
      bet("closed", 10, [["kyle", false], ["joeg", true]]),
      bet("push",   99, [["kyle", true], ["joeg", false]]),
    ]);
    expect(totals.get("kyle")).toBe(10);
    expect(totals.get("joeg")).toBe(-10);
  });
});

describe("formatting", () => {
  it("formats dollars, cents only when needed", () => {
    expect(fmtMoney(20)).toBe("$20");
    expect(fmtMoney(-20)).toBe("-$20");
    expect(fmtMoney(26.666666).startsWith("$26.67")).toBe(true);
  });
  it("nets carry a plus sign", () => {
    expect(fmtNet(20)).toBe("+$20");
    expect(fmtNet(-5)).toBe("-$5");
    expect(fmtNet(0)).toBe("$0");
  });
});
