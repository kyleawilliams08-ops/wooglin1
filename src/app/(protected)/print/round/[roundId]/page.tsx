import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { PrintScorecard } from "@/components/PrintScorecard";
import { effectiveFormat } from "@/lib/matchcalc";
import { loadRoundPrintContext, PRINT_MATCHUP_SELECT, type PrintMatchupRow } from "@/lib/printData";

const MAX_BLANKS = 12;

// Every scorecard for a round in one print job — one landscape page per tee
// time. Lineups that are set print with names + stroke dots; ones that aren't
// (the pairings draft is the night before) print as write-in cards that still
// carry the format, allowance, tee time, par/SI and CTP holes.
//   ?blank=N  → N generic write-in cards instead (no tee-time slots needed)
export default async function PrintRoundPage({
  params,
  searchParams,
}: {
  params: { roundId: string };
  searchParams: { blank?: string };
}) {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const supabase = createClient();
  const ctx = await loadRoundPrintContext(supabase, params.roundId);
  if (!ctx) redirect("/matches");

  const { data: matchupsRaw } = await supabase
    .from("matchups")
    .select(PRINT_MATCHUP_SELECT)
    .eq("round_id", params.roundId)
    .order("match_number");
  const slots = (matchupsRaw ?? []) as unknown as PrintMatchupRow[];

  const wantBlank = Math.min(Math.max(parseInt(searchParams.blank ?? "", 10) || 0, 0), MAX_BLANKS);
  // No tee times yet → fall back to a few generic blanks rather than nothing.
  const blankCount = wantBlank || (slots.length === 0 ? 4 : 0);

  const empty = { home_p1: null, home_p2: null, away_p1: null, away_p2: null };
  const cards = blankCount > 0
    ? Array.from({ length: blankCount }, (_, i) => ({
        key: `blank-${i}`, fmt: ctx.roundFmt,
        matchup: { match_number: null, tee_time: null, ...empty },
      }))
    : slots.map((m) => ({
        key: m.id, fmt: effectiveFormat(m.formats, ctx.roundFmt)!,
        matchup: m,
      }));

  const backHref = `/admin/events/${ctx.eventId}/rounds/${params.roundId}/matchups`;
  const base = `/print/round/${params.roundId}`;
  const unset = slots.filter((m) => !m.home_p1 && !m.away_p1).length;

  return (
    <div className="mx-auto max-w-[10.5in] px-4 py-4 bg-white text-navy">
      <style>{`@media print { @page { size: landscape; margin: 8mm; } }`}</style>

      {/* Screen-only controls */}
      <div className="mb-4 space-y-2 print:hidden">
        <div className="flex items-center justify-between">
          <Link href={backHref} className="text-sm text-navy/50 hover:text-navy">← Tee Times</Link>
          <PrintButton />
        </div>
        <p className="text-sm text-navy/70">
          {blankCount > 0
            ? `${blankCount} blank write-in card${blankCount === 1 ? "" : "s"} — no names, tee times or strokes.`
            : `${cards.length} card${cards.length === 1 ? "" : "s"}, one per tee time${unset > 0 ? ` — ${unset} without a lineup yet (they print as write-in cards)` : ""}.`}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-navy/50">Print instead:</span>
          {slots.length > 0 && (
            <Link href={base}
              className={`rounded-full border px-3 py-1 font-semibold ${blankCount === 0 ? "border-navy bg-navy text-off-white" : "border-hairline text-navy/70"}`}>
              One per tee time ({slots.length})
            </Link>
          )}
          {[2, 4, 6, 8].map((n) => (
            <Link key={n} href={`${base}?blank=${n}`}
              className={`rounded-full border px-3 py-1 font-semibold ${blankCount === n ? "border-navy bg-navy text-off-white" : "border-hairline text-navy/70"}`}>
              {n} blanks
            </Link>
          ))}
        </div>
      </div>

      {cards.map((c, i) => (
        <div key={c.key}
          className={`${i > 0 ? "mt-8 border-t border-dashed border-hairline pt-8 print:mt-0 print:border-0 print:pt-0" : ""} break-inside-avoid`}
          style={i > 0 ? { breakBefore: "page" } : undefined}>
          <PrintScorecard
            event={ctx.event}
            round={ctx.round}
            fmt={c.fmt}
            holes={ctx.holes}
            homeTeam={ctx.homeTeam}
            awayTeam={ctx.awayTeam}
            matchup={c.matchup}
            hcpOf={ctx.hcpOf}
            ctpHoles={ctx.ctpHoles}
          />
        </div>
      ))}
    </div>
  );
}
