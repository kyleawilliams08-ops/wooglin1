import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { PrintScorecard } from "@/components/PrintScorecard";
import { effectiveFormat } from "@/lib/matchcalc";
import { loadRoundPrintContext, PRINT_MATCHUP_SELECT, type PrintMatchupRow } from "@/lib/printData";

// Paper backup scorecard for ONE match: landscape, logo header, handicap math,
// stroke dots, and EMPTY boxes for writing scores when the app is having a bad
// day. (/print/round/[roundId] prints every card in a round at once.)
export default async function PrintScorecardPage({
  params,
}: {
  params: { matchupId: string };
}) {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const supabase = createClient();

  const { data: matchupRaw } = await supabase
    .from("matchups")
    .select(PRINT_MATCHUP_SELECT)
    .eq("id", params.matchupId)
    .single();
  const matchup = matchupRaw as unknown as PrintMatchupRow | null;
  if (!matchup) redirect("/matches");

  const ctx = await loadRoundPrintContext(supabase, matchup.round_id);
  if (!ctx) redirect("/matches");

  return (
    <div className="mx-auto max-w-[10.5in] px-4 py-4 space-y-3 bg-white text-navy">
      <style>{`@media print { @page { size: landscape; margin: 8mm; } }`}</style>

      {/* Screen-only controls */}
      <div className="flex items-center justify-between print:hidden">
        <Link href="/matches" className="text-sm text-navy/50 hover:text-navy">← Matches</Link>
        <PrintButton />
      </div>

      <PrintScorecard
        event={ctx.event}
        round={ctx.round}
        fmt={effectiveFormat(matchup.formats, ctx.roundFmt)!}
        holes={ctx.holes}
        homeTeam={ctx.homeTeam}
        awayTeam={ctx.awayTeam}
        matchup={matchup}
        hcpOf={ctx.hcpOf}
        ctpHoles={ctx.ctpHoles}
      />
    </div>
  );
}
