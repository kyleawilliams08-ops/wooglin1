import { requireRealPlayer, requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ErrorBanner } from "@/components/ErrorBanner";
import { ConfirmForm } from "@/components/ConfirmForm";
import { getTestModeEvent } from "@/lib/currentEvent";
import {
  createTestCopy, deleteTestEvent, enterTestMode, exitTestMode,
  startMasquerade, stopMasquerade,
} from "@/lib/testLabActions";

export const dynamic = "force-dynamic";

// Dress-rehearsal tools. Gated on the REAL signed-in player so it stays
// reachable (to exit) while viewing the app as a non-admin.
export default async function TestLabPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const real = await requireRealPlayer();
  if (!isAdmin(real)) redirect("/");
  const acting = await requirePlayer();
  const supabase = createClient();

  const [{ data: eventsRaw }, { data: players }, testMode] = await Promise.all([
    supabase.from("events").select("*").order("year", { ascending: false }),
    supabase.from("players").select("id, name, nickname, role").order("name"),
    getTestModeEvent(supabase),
  ]);
  type Ev = { id: string; name: string; year: number; status: string; is_test?: boolean };
  const events = (eventsRaw ?? []) as Ev[];
  const testEvents = events.filter((e) => e.is_test);
  const realEvents = events.filter((e) => !e.is_test);
  const defaultSource = realEvents.find((e) => e.status === "active") ?? realEvents[0];

  const card = "rounded-xl border border-hairline bg-white p-4 space-y-3";
  const btn = "rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-off-white";
  const btnGhost = "rounded-lg border border-hairline px-4 py-2 text-sm font-semibold text-navy";

  return (
    <div className="px-4 py-6 space-y-6">
      <Link href="/menu" className="text-sm text-navy/50 hover:text-navy">← Menu</Link>
      <div>
        <h1 className="text-2xl font-display font-bold text-navy">Test Lab</h1>
        <p className="mt-1 text-sm text-navy/60">
          Rehearse the week without touching the real cup. Both modes are yours alone — nobody
          else&rsquo;s app changes — and both switch themselves off after 12 hours.
        </p>
      </div>

      <ErrorBanner message={searchParams.error} />

      {/* ── Test event ─────────────────────────────────────────────── */}
      <div className={card}>
        <p className="font-semibold text-navy">🧪 Test event</p>
        <p className="text-sm text-navy/60">
          A copy of an event&rsquo;s setup — teams, field, rounds, tee times, lineups, handicaps and
          CTP holes — with no scores. It stays a draft, so it never shows up for anyone else.
          While you&rsquo;re in test mode, Home, Matches, the feed and scoring all run against the copy.
        </p>

        {testEvents.map((e) => {
          const inIt = testMode?.id === e.id;
          return (
            <div key={e.id} className={`rounded-lg border px-3 py-3 space-y-2 ${inIt ? "border-gold bg-gold/10" : "border-hairline"}`}>
              <p className="text-sm font-semibold text-navy">
                {e.name} {inIt && <span className="ml-1 text-xs font-bold uppercase tracking-wide text-navy/60">· you&rsquo;re in it</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                {inIt ? (
                  <form action={exitTestMode}><button className={btnGhost}>Exit test mode</button></form>
                ) : (
                  <form action={enterTestMode}>
                    <input type="hidden" name="event_id" value={e.id} />
                    <button className={btn}>Enter test mode</button>
                  </form>
                )}
                <Link href={`/admin/events/${e.id}`} className={btnGhost}>Event setup ›</Link>
                <ConfirmForm action={deleteTestEvent}
                  confirm={`Delete "${e.name}" and everything in it (rounds, tee times, scores, feed)? The real event is not touched.`}>
                  <input type="hidden" name="event_id" value={e.id} />
                  <button className="rounded-lg border border-usa-red/40 px-4 py-2 text-sm font-semibold text-usa-red">
                    Trash it
                  </button>
                </ConfirmForm>
              </div>
            </div>
          );
        })}

        {defaultSource ? (
          <form action={createTestCopy} className="flex flex-wrap items-center gap-2">
            <select name="event_id" defaultValue={defaultSource.id}
              className="min-w-0 flex-1 rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-navy">
              {realEvents.map((e) => (
                <option key={e.id} value={e.id}>{e.name} ({e.year})</option>
              ))}
            </select>
            <button className={btn}>Create test copy</button>
          </form>
        ) : (
          <p className="text-sm text-navy/40">No events to copy yet.</p>
        )}
      </div>

      {/* ── View as ────────────────────────────────────────────────── */}
      <div className={card}>
        <p className="font-semibold text-navy">👁 View as a player</p>
        <p className="text-sm text-navy/60">
          See exactly what someone else sees — their Home, their matches, what they can and
          can&rsquo;t score or set. A banner stays on screen with a one-tap exit.
        </p>
        {acting.masqueradedBy ? (
          <form action={stopMasquerade} className="flex items-center justify-between gap-3 rounded-lg border border-gold bg-gold/10 px-3 py-3">
            <p className="text-sm font-semibold text-navy">Viewing as {acting.nickname ?? acting.name}</p>
            <button className={btnGhost}>Back to me</button>
          </form>
        ) : (
          <form action={startMasquerade} className="flex flex-wrap items-center gap-2">
            <select name="player_id" required defaultValue=""
              className="min-w-0 flex-1 rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-navy">
              <option value="" disabled>Pick a player…</option>
              {(players ?? []).filter((p) => p.id !== real.id).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.nickname ? ` (${p.nickname})` : ""}{p.role !== "player" ? ` · ${p.role}` : ""}
                </option>
              ))}
            </select>
            <button className={btn}>View as</button>
          </form>
        )}
        <div className="rounded-lg bg-usa-red/10 px-3 py-2 text-xs leading-relaxed text-usa-red">
          <p className="font-bold">Anything you do while viewing as someone is saved as them.</p>
          <p>
            Scores, lineups and CTP claims land on whichever event you&rsquo;re in — so use test mode.{" "}
            <span className="font-semibold">Bets are the exception:</span> they&rsquo;re year-wide, not tied to
            an event, so a test bet shows on the real ledger for everyone until you cancel it.
          </p>
        </div>
      </div>
    </div>
  );
}
