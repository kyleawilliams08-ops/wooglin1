// Server-side scoring helpers shared by the full scorecard and the
// hole-by-hole scorer. Authorization mirrors the RLS policies.

import { createClient } from "@/lib/supabase/server";
import { requirePlayer, isAdmin } from "@/lib/auth";

export type SlotKey = "hp1" | "hp2" | "ap1" | "ap2";

const SLOT_COLUMNS: Record<SlotKey, string> = {
  hp1: "home_p1_gross",
  hp2: "home_p2_gross",
  ap1: "away_p1_gross",
  ap2: "away_p2_gross",
};

/**
 * Server-side authorization for scoring actions: admins/assistants, or any
 * player who is IN the match (the architecture's scoring exception).
 * Throws if not allowed.
 */
export async function assertCanScore(matchupId: string) {
  const supabase = createClient();
  const player = await requirePlayer(); // masquerade-aware
  if (isAdmin(player)) return;

  const { data: m } = await supabase
    .from("matchups")
    .select("home_p1_id, home_p2_id, away_p1_id, away_p2_id")
    .eq("id", matchupId)
    .single();
  const epIds = [m?.home_p1_id, m?.home_p2_id, m?.away_p1_id, m?.away_p2_id].filter(Boolean) as string[];
  if (epIds.length === 0) throw new Error("Not authorized to score this match");

  const { data: eps } = await supabase
    .from("event_participants").select("player_id").in("id", epIds);
  if (!eps?.some((ep) => ep.player_id === player.id)) {
    throw new Error("Not authorized to score this match");
  }
}

type ScoreRow = {
  hole_number: number;
  home_p1_gross: number | null; home_p2_gross: number | null;
  away_p1_gross: number | null; away_p2_gross: number | null;
};
type ScoreCol = "home_p1_gross" | "home_p2_gross" | "away_p1_gross" | "away_p2_gross";

/**
 * What the full-card form should write for one hole: only cells that hold a
 * number AND differ from what's stored. A BLANK CELL MEANS "NO CHANGE", never
 * "clear" — a card left open in someone's pocket goes stale (the realtime
 * socket dies while the phone sleeps), and saving it must not wipe the holes
 * their partners entered in the meantime. Scores are cleared from the
 * hole-by-hole scorer instead. Pure — see scoring.test.ts.
 */
export function cardPatch(
  existing: Partial<Record<ScoreCol, number | null>> | undefined,
  form: Partial<Record<ScoreCol, number | null>>,
): Partial<Record<ScoreCol, number>> {
  const patch: Partial<Record<ScoreCol, number>> = {};
  for (const col of Object.keys(form) as ScoreCol[]) {
    const v = form[col];
    if (v == null || !Number.isInteger(v) || v < 1 || v > 15) continue;
    if (existing?.[col] === v) continue;
    patch[col] = v;
  }
  return patch;
}

/**
 * Write a few columns of one hole WITHOUT touching the others. Several phones
 * score the same match at once (each player entering their own ball), so a
 * read-modify-write upsert of the whole row loses updates: two phones read the
 * same row, and whoever writes last blanks the other's score. Update the named
 * columns only; if the row doesn't exist yet, insert it — and if another phone
 * inserts it first (unique violation), fall back to the update.
 * Throws on any failure: a score that didn't save must never look saved.
 */
async function writeHoleColumns(
  supabase: ReturnType<typeof createClient>,
  matchupId: string,
  holeNumber: number,
  patch: Partial<Record<ScoreCol, number | null>>,
) {
  if (Object.keys(patch).length === 0) return;
  const update = () =>
    supabase.from("hole_scores").update(patch)
      .eq("matchup_id", matchupId).eq("hole_number", holeNumber)
      .select("hole_number");

  const first = await update();
  if (first.error) throw new Error(`Score not saved: ${first.error.message}`);
  if ((first.data?.length ?? 0) > 0) return;

  const ins = await supabase.from("hole_scores")
    .insert({ matchup_id: matchupId, hole_number: holeNumber, ...patch });
  if (!ins.error) return;
  if (ins.error.code !== "23505") throw new Error(`Score not saved: ${ins.error.message}`);

  // Lost the insert race to another phone — the row exists now.
  const retry = await update();
  if (retry.error || (retry.data?.length ?? 0) === 0) {
    throw new Error(`Score not saved: ${retry.error?.message ?? "row vanished"}`);
  }
}

/** Save the full scorecard form (merge-safe — see cardPatch). */
export async function upsertHoleScores(
  supabase: ReturnType<typeof createClient>,
  matchupId: string,
  formData: FormData,
) {
  const nums = (formData.get("hole_numbers") as string).split(",").map(Number);
  const { data: existingRows, error } = await supabase
    .from("hole_scores")
    .select("hole_number, home_p1_gross, home_p2_gross, away_p1_gross, away_p2_gross")
    .eq("matchup_id", matchupId);
  if (error) throw new Error(`Scores not saved: ${error.message}`);
  const existing = new Map(((existingRows ?? []) as ScoreRow[]).map((r) => [r.hole_number, r]));

  const parse = (key: string): number | null => {
    const v = formData.get(key);
    return typeof v === "string" && v !== "" ? parseInt(v, 10) : null;
  };
  await Promise.all(nums.map((n) =>
    writeHoleColumns(supabase, matchupId, n, cardPatch(existing.get(n), {
      home_p1_gross: parse(`hp1_${n}`), home_p2_gross: parse(`hp2_${n}`),
      away_p1_gross: parse(`ap1_${n}`), away_p2_gross: parse(`ap2_${n}`),
    })),
  ));
}

/** Save (or clear, with null) a single ball's score on a single hole. */
export async function upsertSingleScore(
  supabase: ReturnType<typeof createClient>,
  matchupId: string,
  holeNumber: number,
  slot: SlotKey,
  value: number | null,
) {
  const col = SLOT_COLUMNS[slot] as ScoreCol | undefined;
  if (!col) throw new Error(`Unknown score slot: ${slot}`);
  await writeHoleColumns(supabase, matchupId, holeNumber, { [col]: value });
}
