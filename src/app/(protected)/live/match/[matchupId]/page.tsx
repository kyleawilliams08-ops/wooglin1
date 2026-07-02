import { requirePlayer } from "@/lib/auth";
import { MatchScorecard } from "@/components/MatchScorecard";
import { LiveRefresher } from "@/components/LiveRefresher";

// Player-facing match page: any member can view; players IN the match
// (and admins) can enter scores. Realtime keeps spectators current.
export default async function LiveMatchPage({
  params,
  searchParams,
}: {
  params: { matchupId: string };
  searchParams: { review?: string };
}) {
  const player = await requirePlayer();

  return (
    <>
      <LiveRefresher matchupId={params.matchupId} />
      <MatchScorecard
        matchupId={params.matchupId}
        currentPath={`/live/match/${params.matchupId}`}
        backHref="/live"
        backLabel="Live Scoreboard"
        viewer={player}
        reviewing={searchParams.review === "1"}
      />
    </>
  );
}
