import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { courseHandicap, formatHcp } from "@/lib/handicap";
import { ErrorBanner } from "@/components/ErrorBanner";
import { failTo } from "@/lib/actionError";

export const dynamic = "force-dynamic";

/**
 * Draft prep sheet: every player in the event with their index and course
 * handicap at each tee set being played. Visible to all members (captains
 * live here before the draft); admins get the Calculate Handicaps button,
 * which pre-draft is otherwise only reachable from a team roster page.
 */
export default async function DraftPrepPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const player = await requirePlayer();
  const admin = isAdmin(player);
  const supabase = createClient();

  // Same event the draft room uses: the most recent draft's event, else the
  // active event.
  const { data: drafts } = await supabase
    .from("drafts").select("event_id").order("created_at", { ascending: false }).limit(1);
  let eventId = drafts?.[0]?.event_id as string | undefined;
  if (!eventId) {
    const { data: actives } = await supabase
      .from("events").select("id").eq("status", "active")
      .order("year", { ascending: false }).limit(1);
    eventId = actives?.[0]?.id;
  }

  if (!eventId) {
    return (
      <div className="px-4 py-6 space-y-4">
        <Link href="/draft" className="text-sm text-navy/50 hover:text-navy">← Draft Room</Link>
        <h1 className="text-2xl font-display font-bold text-navy">Draft Prep</h1>
        <p className="rounded-lg bg-parchment px-4 py-6 text-center text-sm text-navy/50">
          No event set up yet.
        </p>
      </div>
    );
  }

  const { data: event } = await supabase
    .from("events").select("id, name, year").eq("id", eventId).single();

  // Tee sets for the event's courses — the columns of the sheet
  const { data: eventCourses } = await supabase
    .from("event_courses").select("course_id").eq("event_id", eventId);
  const courseIds = (eventCourses ?? []).map((ec) => ec.course_id);
  const { data: teesRaw } = courseIds.length > 0
    ? await supabase
        .from("course_tees")
        .select("id, tee_name, rating, slope, par, courses(name)")
        .in("course_id", courseIds)
        .order("tee_name")
    : { data: [] };
  const tees = (teesRaw ?? []) as unknown as {
    id: string; tee_name: string; rating: number; slope: number; par: number;
    courses: { name: string } | null;
  }[];

  // Everyone in the field (captains + undrafted pool)
  const { data: partsRaw } = await supabase
    .from("event_participants")
    .select("id, player_id, team_id, is_captain, display_name, players(name, nickname, current_index), teams(name, color)")
    .eq("event_id", eventId);
  const parts = (partsRaw ?? []) as unknown as {
    id: string; player_id: string | null; team_id: string | null; is_captain: boolean;
    display_name: string;
    players: { name: string; nickname: string | null; current_index: number | null } | null;
    teams: { name: string; color: string } | null;
  }[];

  // Stored handicaps (override wins), keyed player→tee
  const { data: hcpRows } = await supabase
    .from("participant_handicaps")
    .select("player_id, course_tee_id, calculated_hcp, override_hcp")
    .eq("event_id", eventId);
  const storedHcp = (playerId: string | null, teeId: string): number | null => {
    if (!playerId) return null;
    const row = (hcpRows ?? []).find((h) => h.player_id === playerId && h.course_tee_id === teeId);
    if (!row) return null;
    return row.override_hcp ?? row.calculated_hcp ?? null;
  };

  const rows = parts
    .map((p) => ({
      id: p.id,
      fullName: p.players?.name ?? p.display_name,
      nickname: p.players?.nickname ?? null,
      index: p.players?.current_index ?? null,
      playerId: p.player_id,
      isCaptain: p.is_captain,
      team: p.teams,
    }))
    .sort((a, b) => (a.index ?? 99) - (b.index ?? 99));

  const anyStored = (hcpRows?.length ?? 0) > 0;
  const missingIndex = rows.filter((r) => r.index == null).length;

  async function calculateHandicaps() {
    "use server";
    const me = await requirePlayer();
    if (!isAdmin(me)) redirect("/draft/prep");
    const supabase = createClient();
    const path = "/draft/prep";

    const { data: eps } = await supabase
      .from("event_participants")
      .select("player_id, players(current_index)")
      .eq("event_id", eventId!);
    const { data: ecs } = await supabase
      .from("event_courses").select("course_id").eq("event_id", eventId!);
    const ids = (ecs ?? []).map((ec) => ec.course_id);
    const { data: teeRows } = ids.length > 0
      ? await supabase.from("course_tees").select("id, rating, slope, par").in("course_id", ids)
      : { data: [] };

    for (const ep of eps ?? []) {
      const idx = (ep.players as unknown as { current_index: number | null } | null)?.current_index;
      if (idx == null || !ep.player_id) continue;
      for (const tee of teeRows ?? []) {
        const { error } = await supabase.from("participant_handicaps").upsert({
          event_id:       eventId!,
          player_id:      ep.player_id,
          course_tee_id:  tee.id,
          calculated_hcp: courseHandicap(idx, tee),
        }, { onConflict: "event_id,player_id,course_tee_id", ignoreDuplicates: false });
        failTo(path, error);
      }
    }
    revalidatePath(path);
    redirect(`${path}?saved=1`);
  }

  return (
    <div className="px-4 py-6 space-y-4">
      <Link href="/draft" className="text-sm text-navy/50 hover:text-navy">← Draft Room</Link>
      <div>
        <h1 className="text-2xl font-display font-bold text-navy">Draft Prep</h1>
        <p className="mt-0.5 text-sm text-navy/50">
          {event?.name}{event?.year ? ` · ${event.year}` : ""} · {rows.length} players
        </p>
      </div>
      <ErrorBanner message={searchParams.error} />

      {admin && (
        <form action={calculateHandicaps}>
          <button type="submit"
            className="w-full rounded-lg border border-navy py-2 text-sm font-semibold text-navy transition-colors hover:bg-navy hover:text-off-white">
            {anyStored ? "Re-calculate All Handicaps" : "Calculate Handicaps"}
          </button>
        </form>
      )}

      {tees.length === 0 && (
        <p className="rounded-lg bg-gold/15 px-3 py-2 text-xs text-navy/70">
          No tee sets yet — add the event&rsquo;s courses under Events → Schedule to see course handicaps.
        </p>
      )}
      {missingIndex > 0 && (
        <p className="rounded-lg bg-gold/15 px-3 py-2 text-xs text-navy/70">
          {missingIndex} player{missingIndex === 1 ? " has" : "s have"} no index — set them on the Player Roster.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-hairline bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline bg-parchment text-left text-[11px] uppercase tracking-wide text-navy/50">
              <th className="px-3 py-2 font-semibold">Player</th>
              <th className="px-2 py-2 text-right font-semibold">Index</th>
              {tees.map((t) => (
                <th key={t.id} className="px-2 py-2 text-right font-semibold">
                  <span className="block normal-case text-navy/70">{t.courses?.name}</span>
                  <span className="block text-navy/40">{t.tee_name}</span>
                  {/* rating / slope / par — so the math can be spot-checked */}
                  <span className="mt-0.5 block font-normal normal-case tabular-nums text-navy/40">
                    {t.rating} / {t.slope} / {t.par}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    {r.team && (
                      <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.team.color }} />
                    )}
                    <span className="font-semibold text-navy">{r.fullName}</span>
                    {r.isCaptain && <span className="text-[10px] font-bold uppercase text-gold">C</span>}
                  </span>
                  {r.nickname && r.nickname !== r.fullName && (
                    <span className="block text-[11px] text-navy/40">{r.nickname}</span>
                  )}
                </td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums text-navy">
                  {formatHcp(r.index)}
                </td>
                {tees.map((t) => {
                  const stored = storedHcp(r.playerId, t.id);
                  const live = r.index != null ? courseHandicap(r.index, t) : null;
                  const val = stored ?? live;
                  return (
                    <td key={t.id} className={`px-2 py-2 text-right tabular-nums ${stored != null ? "text-navy" : "text-navy/35"}`}>
                      {val != null ? formatHcp(val) : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-navy/40">
        Tee columns show <span className="tabular-nums">rating / slope / par</span>; course handicap =
        index × (slope ÷ 113) + (rating − par), rounded. Sorted by index. Grey values are previews from
        the player&rsquo;s index;
        {admin ? " hit Calculate to save them for the event." : " an admin can save them with Calculate."}
      </p>
    </div>
  );
}
