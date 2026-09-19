import { describe, it, expect, vi } from "vitest";

// scoring.ts imports the server Supabase client + auth (next/headers); the
// pure helper under test needs neither.
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/auth", () => ({ requirePlayer: async () => ({}), isAdmin: () => false }));

import { cardPatch } from "./scoring";

describe("cardPatch — full-card saves are merge-safe", () => {
  it("writes new scores", () => {
    expect(cardPatch(undefined, { home_p1_gross: 4, away_p1_gross: 5, home_p2_gross: null, away_p2_gross: null }))
      .toEqual({ home_p1_gross: 4, away_p1_gross: 5 });
  });

  it("a blank cell never clears a stored score (stale card in a pocket)", () => {
    // Partners entered hole 7 from their phones; this card still shows blanks.
    const stored = { home_p1_gross: 4, home_p2_gross: 6, away_p1_gross: 5, away_p2_gross: 5 };
    expect(cardPatch(stored, { home_p1_gross: null, home_p2_gross: null, away_p1_gross: null, away_p2_gross: null }))
      .toEqual({});
  });

  it("only sends cells that actually changed", () => {
    const stored = { home_p1_gross: 4, home_p2_gross: 6, away_p1_gross: 5, away_p2_gross: 5 };
    expect(cardPatch(stored, { home_p1_gross: 4, home_p2_gross: 5, away_p1_gross: 5, away_p2_gross: null }))
      .toEqual({ home_p2_gross: 5 });
  });

  it("drops junk values", () => {
    expect(cardPatch(undefined, { home_p1_gross: 0, home_p2_gross: 16, away_p1_gross: NaN, away_p2_gross: 3 }))
      .toEqual({ away_p2_gross: 3 });
  });
});
