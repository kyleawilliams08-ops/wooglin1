import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { ErrorBanner } from "@/components/ErrorBanner";
import { ConfirmForm } from "@/components/ConfirmForm";
import { BetFilter } from "@/components/BetFilter";
import { LedgerList } from "@/components/LedgerList";
import { failTo } from "@/lib/actionError";
import { recordBetClosed, recordBetProtest } from "@/lib/feed";
import { ledgerNets, fmtMoney, fmtNet } from "@/lib/bets";

// ── Types ────────────────────────────────────────────────────────────────────

interface BetPart {
  id: string;
  player_id: string;
  side: number | null;
  is_winner: boolean | null;
  players: { nickname: string | null; name: string } | null;
}
interface Bet {
  id: string;
  year: number;
  bet_type: "h2h" | "teams" | "group";
  amount: number;
  description: string | null;
  status: "pending" | "active" | "closed" | "push" | "void" | "protested";
  created_by: string | null;
  protested_by: string | null;
  created_at: string;
  bet_participants: BetPart[];
}

const pname = (p: BetPart) => p.players?.nickname ?? p.players?.name ?? "?";
// Old acceptance-era 'pending' rows behave like active bets
const isOpen = (b: Bet) => b.status === "active" || b.status === "pending";

/** Server-side actor lookup for actions (id + admin flag + label). */
async function getActor(supabase: ReturnType<typeof createClient>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase
    .from("players").select("id, role, name, nickname").eq("auth_user_id", user.id).single();
  if (!me) redirect("/login");
  return {
    id: me.id as string,
    admin: me.role === "admin" || me.role === "assistant",
    label: (me.nickname ?? me.name) as string,
  };
}

/** Fetch one bet with participants, for action guards. */
async function getBet(supabase: ReturnType<typeof createClient>, betId: string) {
  const { data } = await supabase
    .from("bets")
    .select("id, status, created_by, protested_by, protested_from, bet_participants(id, player_id, side, is_winner)")
    .eq("id", betId)
    .single();
  return data as unknown as {
    id: string; status: string; created_by: string | null; protested_by: string | null; protested_from: string | null;
    bet_participants: { id: string; player_id: string; side: number | null; is_winner: boolean | null }[];
  } | null;
}

export default async function BetsPage({
  searchParams,
}: {
  searchParams: { error?: string; who?: string; status?: string; tab?: string };
}) {
  const player = await requirePlayer();
  const admin = isAdmin(player);
  const supabase = createClient();
  const year = new Date().getFullYear();

  const { data: allPlayers } = await supabase
    .from("players").select("id, name, nickname").order("name");
  const labelOf = new Map((allPlayers ?? []).map((p) => [p.id as string, (p.nickname ?? p.name) as string]));

  const { data: betsRaw } = await supabase
    .from("bets")
    .select("id, year, bet_type, amount, description, status, created_by, protested_by, created_at, bet_participants(id, player_id, side, is_winner, players(nickname, name))")
    .eq("year", year)
    .order("created_at", { ascending: false });
  const bets = (betsRaw ?? []) as unknown as Bet[];

  const mine = (b: Bet) => b.bet_participants.some((p) => p.player_id === player.id);

  // Front and center: your bets that need action — protests hottest, then
  // open bets awaiting close-out.
  const attention = bets
    .filter((b) => mine(b) && (isOpen(b) || b.status === "protested"))
    .sort((a, b) => (a.status === "protested" ? 0 : 1) - (b.status === "protested" ? 0 : 1));

  // History list — the full archive matching the filters. (Your open/protested
  // bets are also pinned in the Open Action panel above; that's a shortcut, so
  // they still belong in History too — otherwise an "Open" filter looks empty.)
  const who = searchParams.who === "me" ? "me" : "all";
  const statusF = ["open", "settled", "protested"].includes(searchParams.status ?? "")
    ? (searchParams.status as "open" | "settled" | "protested")
    : "all";
  const statusMatch = (b: Bet) =>
    statusF === "all" ? true
    : statusF === "open" ? isOpen(b)
    : statusF === "protested" ? b.status === "protested"
    : b.status === "closed" || b.status === "push";
  const visible = bets.filter(
    (b) => b.status !== "void" && statusMatch(b) && (who === "me" ? mine(b) : true),
  );
  const tab = searchParams.tab === "history" ? "history" : "ledger";

  const totals = ledgerNets(bets.map((b) => ({ ...b, amount: Number(b.amount) })));
  const myNet = totals.get(player.id) ?? 0;
  const ledger = Array.from(totals.entries())
    .filter(([pid]) => labelOf.has(pid))
    .sort((a, b) => b[1] - a[1])
    .map(([pid, net]) => ({ id: pid, name: labelOf.get(pid) ?? "?", net }));

  // ── Actions ────────────────────────────────────────────────────────────────

  async function closeBet(formData: FormData) {
    "use server";
    const supabase = createClient();
    const me = await getActor(supabase);
    const betId = formData.get("bet_id") as string;
    const winner = formData.get("winner") as string; // side1 | side2 | push | <player_id>

    const bet = await getBet(supabase, betId);
    if (!bet || !(bet.status === "active" || bet.status === "pending")) {
      failTo("/bets", { message: "Bet isn't open" });
    }
    const parts = bet!.bet_participants;
    if (!parts.some((p) => p.player_id === me.id) && !me.admin) {
      failTo("/bets", { message: "Only someone in the bet can close it" });
    }

    if (winner === "push") {
      const { error } = await supabase
        .from("bets")
        .update({ status: "push", closed_by: me.id, closed_at: new Date().toISOString() })
        .eq("id", betId);
      failTo("/bets", error);
      revalidatePath("/bets");
      return;
    }

    let winnerIds: string[];
    if (winner === "side1" || winner === "side2") {
      const side = winner === "side1" ? 1 : 2;
      winnerIds = parts.filter((p) => p.side === side).map((p) => p.player_id);
    } else {
      winnerIds = parts.some((p) => p.player_id === winner) ? [winner] : [];
    }
    if (winnerIds.length === 0) failTo("/bets", { message: "Pick a valid winner" });

    for (const p of parts) {
      const { error } = await supabase
        .from("bet_participants")
        .update({ is_winner: winnerIds.includes(p.player_id) })
        .eq("id", p.id);
      failTo("/bets", error);
    }
    const { error } = await supabase
      .from("bets")
      .update({ status: "closed", closed_by: me.id, closed_at: new Date().toISOString() })
      .eq("id", betId);
    failTo("/bets", error);
    await recordBetClosed(supabase, betId); // best-effort feed post
    revalidatePath("/bets");
    revalidatePath("/");
  }

  // Creator can cancel an open bet (typo / changed their mind before play)
  async function cancelBet(formData: FormData) {
    "use server";
    const supabase = createClient();
    const me = await getActor(supabase);
    const betId = formData.get("bet_id") as string;
    const bet = await getBet(supabase, betId);
    if (!bet || !(bet.status === "active" || bet.status === "pending")) {
      failTo("/bets", { message: "Bet isn't open" });
    }
    if (bet!.created_by !== me.id && !me.admin) {
      failTo("/bets", { message: "Only the proposer or an admin can cancel" });
    }
    const { error } = await supabase.from("bets").update({ status: "void" }).eq("id", betId);
    failTo("/bets", error);
    revalidatePath("/bets");
  }

  // Losers can protest a closed bet — freezes it out of the ledger
  async function protestBet(formData: FormData) {
    "use server";
    const supabase = createClient();
    const me = await getActor(supabase);
    const betId = formData.get("bet_id") as string;
    const bet = await getBet(supabase, betId);
    if (!bet || !(bet.status === "closed" || bet.status === "push")) {
      failTo("/bets", { message: "Only settled bets can be protested" });
    }
    const isPart = bet!.bet_participants.some((p) => p.player_id === me.id);
    if (!isPart) failTo("/bets", { message: "Only someone in the bet can protest" });
    if (bet!.status === "closed") {
      const meLost = bet!.bet_participants.some((p) => p.player_id === me.id && p.is_winner !== true);
      if (!meLost) failTo("/bets", { message: "Only the losing side can protest a result" });
    }
    const { error } = await supabase
      .from("bets")
      .update({ status: "protested", protested_by: me.id, protested_from: bet!.status })
      .eq("id", betId);
    failTo("/bets", error);
    await recordBetProtest(supabase, betId, me.label); // best-effort feed post
    revalidatePath("/bets");
    revalidatePath("/");
  }

  // Protester can withdraw — result stands
  async function withdrawProtest(formData: FormData) {
    "use server";
    const supabase = createClient();
    const me = await getActor(supabase);
    const betId = formData.get("bet_id") as string;
    const bet = await getBet(supabase, betId);
    if (!bet || bet.status !== "protested") failTo("/bets", { message: "No protest to withdraw" });
    if (bet!.protested_by !== me.id && !me.admin) failTo("/bets", { message: "Only the protester can withdraw" });
    const restore = bet!.protested_from === "push" ? "push" : "closed";
    const { error } = await supabase
      .from("bets").update({ status: restore, protested_by: null, protested_from: null }).eq("id", betId);
    failTo("/bets", error);
    revalidatePath("/bets");
    revalidatePath("/");
  }

  // Winners can concede a protested bet — voids it, no money moves
  async function concedeBet(formData: FormData) {
    "use server";
    const supabase = createClient();
    const me = await getActor(supabase);
    const betId = formData.get("bet_id") as string;
    const bet = await getBet(supabase, betId);
    if (!bet || bet.status !== "protested") failTo("/bets", { message: "Bet isn't protested" });
    const meWon = bet!.bet_participants.some((p) => p.player_id === me.id && p.is_winner === true);
    if (!meWon && !me.admin) failTo("/bets", { message: "Only the winning side can concede" });
    const { error } = await supabase
      .from("bets").update({ status: "void", protested_by: null, protested_from: null }).eq("id", betId);
    failTo("/bets", error);
    revalidatePath("/bets");
    revalidatePath("/");
  }

  // Commish: protest denied, result stands
  async function dismissProtest(formData: FormData) {
    "use server";
    const supabase = createClient();
    const me = await getActor(supabase);
    if (!me.admin) failTo("/bets", { message: "Admins only" });
    const betId = formData.get("bet_id") as string;
    const bet = await getBet(supabase, betId);
    if (!bet || bet.status !== "protested") failTo("/bets", { message: "No protest to dismiss" });
    const restore = bet!.protested_from === "push" ? "push" : "closed";
    const { error } = await supabase
      .from("bets").update({ status: restore, protested_by: null, protested_from: null })
      .eq("id", betId);
    failTo("/bets", error);
    revalidatePath("/bets");
    revalidatePath("/");
  }

  // Commish: reopen for a re-close (from settled or protested)
  async function adminReopen(formData: FormData) {
    "use server";
    const supabase = createClient();
    const me = await getActor(supabase);
    if (!me.admin) failTo("/bets", { message: "Admins only" });
    const { error } = await supabase
      .from("bets")
      .update({ status: "active", closed_by: null, closed_at: null, protested_by: null, protested_from: null })
      .eq("id", formData.get("bet_id") as string)
      .in("status", ["closed", "push", "protested"]);
    failTo("/bets", error);
    revalidatePath("/bets");
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  const sideNames = (b: Bet, side: number) =>
    b.bet_participants.filter((p) => p.side === side).map(pname).join(" / ");

  const participantsLine = (b: Bet) =>
    b.bet_type === "group"
      ? b.bet_participants.map(pname).join(" · ")
      : `${sideNames(b, 1)} vs ${sideNames(b, 2)}`;

  const typeLabel: Record<Bet["bet_type"], string> = {
    h2h: "1 on 1", teams: "2 v 2", group: "Group",
  };

  const btn = "rounded-lg px-3 py-1.5 text-xs font-semibold";

  function BetCard({ b }: { b: Bet }) {
    const isPart = mine(b);
    const isCreator = b.created_by === player.id;
    const winners = b.bet_participants.filter((p) => p.is_winner === true);
    const iWon = b.bet_participants.some((p) => p.player_id === player.id && p.is_winner === true);
    const iLost = isPart && !iWon;

    return (
      <div className={`rounded-xl border bg-white p-3 space-y-2 ${b.status === "protested" ? "border-usa-red/50" : "border-hairline"}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-navy truncate">
              {b.description || typeLabel[b.bet_type]}
            </p>
            <p className="text-xs text-navy/50 mt-0.5 truncate">{participantsLine(b)}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-bold text-navy tabular-nums">{fmtMoney(Number(b.amount))}</p>
            <p className="text-[10px] text-navy/40 uppercase">{typeLabel[b.bet_type]}{b.bet_type !== "group" ? "" : ` · ${b.bet_participants.length} in`}</p>
          </div>
        </div>

        {/* Open: one-tap close-out for participants/admins */}
        {isOpen(b) && (isPart || admin) && (
          <div className="border-t border-hairline pt-2 space-y-1.5">
            <p className="text-[11px] text-navy/40">Close out — who won?</p>
            <div className="flex flex-wrap gap-1.5">
              {b.bet_type !== "group" ? (
                <>
                  <ConfirmForm action={closeBet}
                    confirm={`Close this bet: ${sideNames(b, 1)} win${b.bet_participants.filter((p) => p.side === 1).length > 1 ? "" : "s"} ${fmtMoney(Number(b.amount))} per person?`}>
                    <input type="hidden" name="bet_id" value={b.id} />
                    <input type="hidden" name="winner" value="side1" />
                    <button className={`${btn} bg-navy text-off-white`}>{sideNames(b, 1)}</button>
                  </ConfirmForm>
                  <ConfirmForm action={closeBet}
                    confirm={`Close this bet: ${sideNames(b, 2)} win${b.bet_participants.filter((p) => p.side === 2).length > 1 ? "" : "s"} ${fmtMoney(Number(b.amount))} per person?`}>
                    <input type="hidden" name="bet_id" value={b.id} />
                    <input type="hidden" name="winner" value="side2" />
                    <button className={`${btn} bg-navy text-off-white`}>{sideNames(b, 2)}</button>
                  </ConfirmForm>
                </>
              ) : (
                <ConfirmForm action={closeBet} className="flex flex-1 items-center gap-1.5"
                  confirm={`Close this bet with the selected winner taking ${fmtMoney(Number(b.amount) * (b.bet_participants.length - 1))}?`}>
                  <input type="hidden" name="bet_id" value={b.id} />
                  <select name="winner" required defaultValue=""
                    className="flex-1 rounded-lg border border-hairline bg-white px-2 py-1.5 text-xs text-navy">
                    <option value="" disabled>Winner…</option>
                    {b.bet_participants.map((p) => (
                      <option key={p.id} value={p.player_id}>{pname(p)}</option>
                    ))}
                  </select>
                  <button className={`${btn} bg-navy text-off-white`}>Set</button>
                </ConfirmForm>
              )}
              <ConfirmForm action={closeBet} confirm="Call this bet a push? No money moves.">
                <input type="hidden" name="bet_id" value={b.id} />
                <input type="hidden" name="winner" value="push" />
                <button className={`${btn} border border-hairline text-navy/60`}>Push</button>
              </ConfirmForm>
              {(isCreator || admin) && (
                <form action={cancelBet}>
                  <input type="hidden" name="bet_id" value={b.id} />
                  <button className={`${btn} border border-usa-red/50 text-usa-red`}>Cancel</button>
                </form>
              )}
            </div>
          </div>
        )}

        {/* Settled */}
        {(b.status === "closed" || b.status === "push") && (
          <div className="flex items-center justify-between border-t border-hairline pt-2">
            <p className="text-xs font-semibold text-navy">
              {b.status === "push" ? "Push — no money moves" : `🏆 ${winners.map(pname).join(" / ")}`}
            </p>
            <div className="flex items-center gap-3">
              {((b.status === "closed" && iLost) || (b.status === "push" && isPart)) && (
                <form action={protestBet}>
                  <input type="hidden" name="bet_id" value={b.id} />
                  <button className="text-[11px] text-usa-red underline underline-offset-2">Protest</button>
                </form>
              )}
              {admin && (
                <form action={adminReopen}>
                  <input type="hidden" name="bet_id" value={b.id} />
                  <button className="text-[11px] text-navy/40 underline underline-offset-2">Reopen</button>
                </form>
              )}
            </div>
          </div>
        )}

        {/* Protested: resolution paths */}
        {b.status === "protested" && (
          <div className="border-t border-usa-red/30 pt-2 space-y-1.5">
            <p className="text-xs font-semibold text-usa-red">
              ⚠️ Protested by {labelOf.get(b.protested_by ?? "") ?? "?"} — frozen out of the ledger
            </p>
            <div className="flex flex-wrap gap-1.5">
              {iWon && (
                <form action={concedeBet}>
                  <input type="hidden" name="bet_id" value={b.id} />
                  <button className={`${btn} border border-usa-red text-usa-red`}>Concede (void bet)</button>
                </form>
              )}
              {b.protested_by === player.id && (
                <form action={withdrawProtest}>
                  <input type="hidden" name="bet_id" value={b.id} />
                  <button className={`${btn} border border-hairline text-navy/60`}>Withdraw protest</button>
                </form>
              )}
              {admin && (
                <>
                  <form action={dismissProtest}>
                    <input type="hidden" name="bet_id" value={b.id} />
                    <button className={`${btn} bg-navy text-off-white`}>Dismiss — result stands</button>
                  </form>
                  <form action={adminReopen}>
                    <input type="hidden" name="bet_id" value={b.id} />
                    <button className={`${btn} border border-hairline text-navy/60`}>Reopen</button>
                  </form>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Page ───────────────────────────────────────────────────────────────────

  return (
    <div className="px-4 py-6 space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy">Betting</h1>
          <p className="text-sm text-navy/50 mt-0.5">{year} fund · settle up at year&rsquo;s end</p>
        </div>
        <div className="text-right">
          <p className={`text-xl font-bold tabular-nums ${myNet > 0 ? "text-europe-green" : myNet < 0 ? "text-usa-red" : "text-navy"}`}>
            {fmtNet(myNet)}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-navy/40">Your net</p>
        </div>
      </div>

      <ErrorBanner message={searchParams.error} />

      {/* Open action — protests + open bets you can close, one tap */}
      {attention.length > 0 && (
        <div className="rounded-2xl border border-gold/60 bg-parchment p-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-navy/60">
            ⚡ Open Action ({attention.length})
          </p>
          {attention.map((b) => <BetCard key={b.id} b={b} />)}
        </div>
      )}

      <Link href="/bets/new"
        className="block w-full rounded-xl bg-navy py-3.5 text-center text-base font-semibold text-off-white">
        + Propose a Bet
      </Link>

      {/* Ledger / History tabs — one at a time */}
      <div className="flex gap-2">
        {([["ledger", "Ledger"], ["history", "History"]] as const).map(([t, label]) => (
          <Link key={t} href={`/bets?tab=${t}`}
            className={`flex-1 rounded-full border px-4 py-2 text-center text-sm font-semibold ${
              tab === t ? "bg-navy text-off-white border-navy" : "bg-white text-navy/60 border-hairline"
            }`}>
            {label}
          </Link>
        ))}
      </div>

      {tab === "ledger" ? (
        ledger.length === 0 ? (
          <p className="text-sm text-navy/50">No bets yet — nothing to settle.</p>
        ) : (
          <LedgerList entries={ledger} />
        )
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-navy/50">
              {who === "me" ? "Your bets" : "All bets"}
              {statusF !== "all" ? ` · ${statusF}` : ""}
            </p>
            <span className="flex items-center gap-3">
              {(who !== "all" || statusF !== "all") && (
                <Link href="/bets?tab=history" className="text-[11px] font-semibold text-navy/50 underline underline-offset-2">
                  Clear
                </Link>
              )}
              <BetFilter />
            </span>
          </div>
          {visible.length === 0 ? (
            <p className="text-sm text-navy/50">No bets match these filters.</p>
          ) : (
            <div className="space-y-2">{visible.map((b) => <BetCard key={b.id} b={b} />)}</div>
          )}
        </div>
      )}
    </div>
  );
}
