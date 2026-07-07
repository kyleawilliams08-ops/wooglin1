import { describe, it, expect } from "vitest";
import { roundForPick, teamIndexForPick, pickLabel, clockRemaining } from "./draft";

describe("roundForPick", () => {
  it("groups picks in twos", () => {
    expect(roundForPick(1)).toBe(1);
    expect(roundForPick(2)).toBe(1);
    expect(roundForPick(3)).toBe(2);
    expect(roundForPick(4)).toBe(2);
    expect(roundForPick(9)).toBe(5);
  });
});

describe("teamIndexForPick (snake)", () => {
  it("runs A B | B A | A B | B A", () => {
    const seq = [1, 2, 3, 4, 5, 6, 7, 8].map(teamIndexForPick);
    expect(seq).toEqual([0, 1, 1, 0, 0, 1, 1, 0]);
  });

  it("gives the first-pick team picks 1, 4, 5, 8, 9…", () => {
    const teamA = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
      .filter((n) => teamIndexForPick(n) === 0);
    expect(teamA).toEqual([1, 4, 5, 8, 9, 12]);
  });

  it("splits an even pool evenly", () => {
    const picks = Array.from({ length: 14 }, (_, i) => teamIndexForPick(i + 1));
    expect(picks.filter((t) => t === 0)).toHaveLength(7);
    expect(picks.filter((t) => t === 1)).toHaveLength(7);
  });

  it("an odd pool leaves the teams one apart", () => {
    const picks = Array.from({ length: 15 }, (_, i) => teamIndexForPick(i + 1));
    const a = picks.filter((t) => t === 0).length;
    const b = picks.filter((t) => t === 1).length;
    expect(Math.abs(a - b)).toBe(1);
    expect(a + b).toBe(15);
  });
});

describe("pickLabel", () => {
  it("formats round and pick", () => {
    expect(pickLabel(1)).toBe("Rd 1 · Pick 1");
    expect(pickLabel(4)).toBe("Rd 2 · Pick 4");
  });
});

describe("clockRemaining", () => {
  const t0 = new Date("2026-08-14T19:00:00Z");

  it("is null before the clock starts", () => {
    expect(clockRemaining(null, 120)).toBeNull();
  });

  it("counts down from pickSeconds", () => {
    expect(clockRemaining(t0.toISOString(), 120, t0.getTime())).toBe(120);
    expect(clockRemaining(t0.toISOString(), 120, t0.getTime() + 45_000)).toBe(75);
  });

  it("goes negative when they dawdle (soft clock — nothing fires)", () => {
    expect(clockRemaining(t0.toISOString(), 120, t0.getTime() + 150_000)).toBe(-30);
  });
});
