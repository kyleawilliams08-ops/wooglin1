import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { DraftRoom, type DraftView, type DraftTeam } from "@/components/DraftRoom";

export const dynamic = "force-dynamic";

/**
 * The draft room. Shows the most recent draft (scheduled, live, or the
 * completed recap). ?tv=1 renders the big-screen casting view.
 */
export default async function DraftPage({
  searchParams,
}: {
  searchParams: { tv?: string };
}) {
  const player = await requirePlayer();
  const supabase = createClient();

  const { data: drafts } = await supabase
    .from("drafts")
    .select("*, events(id, name, year)")
    .order("created_at", { ascending: false })
    .limit(1);
  const draft = drafts?.[0] ?? null;

  if (!draft) {
    return (
      <div className="px-4 py-6 space-y-4">
        <h1 className="text-2xl font-display font-bold text-navy">Draft Room</h1>
        <div className="rounded-2xl border border-dashed border-hairline px-4 py-10 text-center">
          <p className="text-sm text-navy/50">
            No draft on the books yet. The commissioner sets one up before draft day.
          </p>
          {isAdmin(player) && (
            <Link href="/admin/draft" className="mt-3 inline-block rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-off-white">
              Set up the draft →
            </Link>
          )}
        </div>
      </div>
    );
  }

  const event = draft.events as unknown as { id: string; name: string; year: number };

  // Teams in snake order: first-pick team first (defaults to home team).
  const { data: teamsRaw } = await supabase
    .from("teams").select("id, name, color").eq("event_id", event.id).order("name");
  const teams = teamsRaw ?? [];
  const first = teams.find((t) => t.id === draft.first_pick_team_id) ?? teams[0];
  const other = teams.find((t) => t.id !== first?.id);

  if (!first || !other) {
    return (
      <div className="px-4 py-6 space-y-4">
        <h1 className="text-2xl font-display font-bold text-navy">Draft Room</h1>
        <p className="rounded-lg bg-usa-red/10 px-3 py-2 text-sm text-usa-red">
          This event needs two teams before the draft can run.
        </p>
      </div>
    );
  }

  // Everyone in the event: captains head the columns, the un-teamed are the pool.
  const { data: participants } = await supabase
    .from("event_participants")
    .select("id, player_id, team_id, display_name, is_captain, players(nickname, name, avatar_url, current_index)")
    .eq("event_id", event.id);
  type Part = {
    id: string; player_id: string | null; team_id: string | null;
    display_name: string; is_captain: boolean;
    players: { nickname: string | null; name: string; avatar_url: string | null; current_index: number | null } | null;
  };
  const parts = (participants ?? []) as unknown as Part[];
  const nameOf = (p: Part) => p.players?.nickname ?? p.display_name;

  const captainFor = (teamId: string) =>
    parts.find((p) => p.is_captain && p.team_id === teamId) ?? null;
  const toTeam = (t: { id: string; name: string; color: string }): DraftTeam => {
    const cap = captainFor(t.id);
    return { ...t, captainName: cap ? nameOf(cap) : null };
  };

  const { data: picksRaw } = await supabase
    .from("draft_picks")
    .select("id, pick_number, team_id, participant_id")
    .eq("draft_id", draft.id)
    .order("pick_number");
  const byId = new Map(parts.map((p) => [p.id, p]));
  const picks = (picksRaw ?? []).map((pk) => {
    const part = byId.get(pk.participant_id);
    return {
      ...pk,
      name: part ? nameOf(part) : "?",
      avatarUrl: part?.players?.avatar_url ?? null,
    };
  });

  // Pool + career stats (appearances / cup record) for the mini player cards
  const pool = parts.filter((p) => !p.is_captain && !p.team_id);
  const poolPlayerIds = pool.map((p) => p.player_id).filter((id): id is string => !!id);
  const { data: appearances } = poolPlayerIds.length
    ? await supabase
        .from("player_appearances")
        .select("player_id, result")
        .in("player_id", poolPlayerIds)
    : { data: [] };
  const statsFor = (playerId: string | null) => {
    const mine = (appearances ?? []).filter((a) => a.player_id === playerId);
    const w = mine.filter((a) => a.result === "W").length;
    const l = mine.filter((a) => a.result === "L").length;
    const t = mine.filter((a) => a.result === "T").length;
    return {
      appearances: mine.length,
      record: mine.length ? `${w}–${l}${t > 0 ? `–${t}` : ""}` : "—",
    };
  };

  // Sort the pool best-index-first — the "big board"
  const poolView = pool
    .map((p) => ({
      participantId: p.id,
      name: nameOf(p),
      avatarUrl: p.players?.avatar_url ?? null,
      index: p.players?.current_index ?? null,
      ...statsFor(p.player_id),
    }))
    .sort((a, b) => (a.index ?? 99) - (b.index ?? 99));

  const myCaptaincy = parts.find((p) => p.is_captain && p.player_id === player.id);

  const view: DraftView = {
    id: draft.id,
    status: draft.status,
    scheduled_at: draft.scheduled_at,
    pick_seconds: draft.pick_seconds,
    call_link: draft.call_link,
    current_pick_started_at: draft.current_pick_started_at,
    eventName: event.name,
    eventYear: event.year,
    teams: [toTeam(first), toTeam(other)],
    picks,
    pool: poolView,
    captainOf: myCaptaincy?.team_id ?? null,
    viewerIsAdmin: isAdmin(player),
  };

  const tv = searchParams.tv === "1";

  return (
    <div className="px-4 py-6 space-y-4">
      {!tv && (
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-display font-bold text-navy">
            {event.year} Draft
          </h1>
          {isAdmin(player) && (
            <Link href="/admin/draft" className="text-sm text-navy/50 underline underline-offset-2 hover:text-navy">
              Draft setup
            </Link>
          )}
        </div>
      )}
      <DraftRoom draft={view} tv={tv} />
    </div>
  );
}
