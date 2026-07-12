import { requirePlayer, isAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { MatchScorecard } from "@/components/MatchScorecard";

export default async function AdminScorecardPage({
  params,
  searchParams,
}: {
  params: { id: string; roundId: string; matchupId: string };
  searchParams: { review?: string };
}) {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const base = `/admin/events/${params.id}/rounds/${params.roundId}/matchups`;
  return (
    <MatchScorecard
      matchupId={params.matchupId}
      currentPath={`${base}/${params.matchupId}/scorecard`}
      backHref={base}
      backLabel="Matchups"
      viewer={player}
      reviewing={searchParams.review === "1"}
      hbhHref={`/live/match/${params.matchupId}`}
    />
  );
}
