import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { CreateBetForm } from "@/components/CreateBetForm";
import { ErrorBanner } from "@/components/ErrorBanner";
import { failTo } from "@/lib/actionError";
import { recordBetClosed } from "@/lib/feed";
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
  status: "pending" | "active" | "closed" | "push" | "void";
  created_by: string | null;
  created_at: string;
  bet_participants: BetPart[];
}

const pname = (p: BetPart) => p.players?.nickname ?? p.players?.name ?? "?";

/** Server-side actor lookup for actions (id + admin flag). */
async function getActor(supabase: ReturnType<typeof createClient>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase
    .from("players").select("id, role").eq("auth_user_id", user.id).single();
  if (!me) redirect("/login");
  return { id: me.id as string, admin: me.role === "admin" || me.role === "assistant" };
}

export default async function BetsPage({
  searchParams,
}: {
  searchParams: { error?: string; who?: string; status?: string };
}) {
  const player = await requirePlayer();
  const admin = isAdmin(player);
  const supabase = createClient();
  const year = new Date().getFullYear();

  const { data: allPlayers } = await supabase
    .from("players").select("id, name, nickname").order("name");
  const playerOptions = (allPlayers ?? []).map((p) => ({
    id: p.id as string,
    label: (p.nickname ?? p.name) as string,
  }));
  const labelOf = new Map(playerOptions.map((p) => [p.id, p.label]));

  // Limit bet participants to the current cup's roster (fall back to
  // everyone when no event is active — the fund outlives the weekend).
  const { data: activeEvents } = await supabase
    .from("events").select("id").eq("status", "active")
    .order("year", { ascending: false }).limit(1);
  let rosterIds: Set<string> | null = null;
  if (activeEvents?.[0]) {
    const { data: eps } = await supabase
      .from("event_participants")
      .select("player_id")
      .eq("event_id", activeEvents[0].id)
      .not("player_id", "is", null);
    const ids = (eps ?? []).map((e) => e.player_id as string);
    if (ids.length > 0) rosterIds = new Set(ids);
  }
  const betOptions = rosterIds
    ? playerOptions.filter((p) => rosterIds!.has(p.id))
    : playerOptions;

  const { data: betsRaw } = await supabase
    .from("bets")
    .select("id, year, bet_type, amount, description, status, created_by, created_at, bet_participants(id, player_id, side, is_winner, players(nickname, name))")
    .eq("year", year)
    .order("created_at", { ascending: false });
  const bets = (betsRaw ?? []) as unknown as Bet[];

  // Bets list filters: default to YOUR bets, all statuses
  const who = searchParams.who === "all" ? "all" : "me";
  const statusF = ["pending", "open", "settled"].includes(searchParams.status ?? "")
    ? (searchParams.status as "pending" | "open" | "settled")
    : "all";
  const mine = (b: Bet) => b.bet_participants.some((p) => p.player_id === player.id);
  const statusMatch = (b: Bet) =>
    statusF === "all" ? true
    : statusF === "pending" ? b.status === "pending"
    : statusF === "open" ? b.status === "active"
    : b.status === "closed" || b.status === "push";
  const statusPrio: Record<string, number> = { pending: 0, active: 1, closed: 2, push: 2 };
  const visible = bets
    .filter((b) => b.status !== "void" && statusMatch(b) && (who === "me" ? mine(b) : true))
    .sort((a, b) => (statusPrio[a.status] ?? 3) - (statusPrio[b.status] ?? 3));
  const flt = (w: string, s: string) => `/bets?who=${w}&status=${s}`;

  const totals = ledgerNets(bets.map((b) => ({ ...b, amount: Number(b.amount) })));
  const myNet = totals.get(player.id) ?? 0;
  const ledger = Array.from(totals.entries())
    .filter(([pid]) => labelOf.has(pid))
    .sort((a, b) => b[1] - a[1]);

  // ── Actions ────────────────────────────────────────────────────────────────

  async function createBet(formData: FormData) {
    "use server";
    const supabase = createClient();
    const me = await getActor(supabase);
    const type = formData.get("bet_type") as string;
    const amount = parseFloat(formData.get("amount") as string);
    const description = (formData.get("description") as string)?.trim() || null;
    if (!["h2h", "teams", "group"].includes(type)) failTo("/bets", { message: "Unknown bet type" });
    if (!(amount > 0)) failTo("/bets", { message: "Amount must be positive" });

    const parts: { player_id: string; side: number | null }[] = [];
    if (type === "h2h") {
      const opp = formData.get("opponent") as string;
      if (!opp || opp === me.id) failTo("/bets", { message: "Pick an opponent" });
      parts.push({ player_id: me.id, side: 1 }, { player_id: opp, side: 2 });
    } else if (type === "teams") {
      const partner = formData.get("partner") as string;
      const opp1 = formData.get("opp1") as string;
      const opp2 = formData.get("opp2") as string;
      const ids = [me.id, partner, opp1, opp2];
      if (ids.some((x) => !x) || new Set(ids).size !== 4) {
        failTo("/bets", { message: "A 2v2 needs four different players" });
      }
      parts.push(
        { player_id: me.id, side: 1 }, { player_id: partner, side: 1 },
        { player_id: opp1, side: 2 }, { player_id: opp2, side: 2 },
      );
    } else {
      const ids = (formData.getAll("group_ids") as string[]).filter((x) => x && x !== me.id);
      if (new Set(ids).size < 2) failTo("/bets", { message: "A group bet needs at least 2 others" });
      parts.push({ player_id: me.id, side: null });
      for (const pid of Array.from(new Set(ids))) parts.push({ player_id: pid, side: null });
    }

    const { data: betRow, error } = await supabase
      .from("bets")
      .insert({ year: new Date().getFullYear(), bet_type: type, amount, description, status: "pending", created_by: me.id })
      .select("id")
      .single();
    failTo("/bets", error);
    const { error: pErr } = await supabase
      .from("bet_participants")
      .insert(parts.map((p) => ({ ...p, bet_id: betRow!.id })));
    failTo("/bets", pErr);
    revalidatePath("/bets");
  }

  async function acceptBet(formData: FormData) {
    "use server";
    const supabase = createClient();
    const me = await getActor(supabase);
    const betId = formData.get("bet_id") as string;
    const { data: bet } = await supabase
      .from("bets").select("status, created_by, bet_participants(player_id)").eq("id", betId).single();
    const parts = (bet?.bet_participants ?? []) as { player_id: string }[];
    if (!bet || bet.status !== "pending") failTo("/bets", { message: "Bet is no longer pending" });
    if (!parts.some((p) => p.player_id === me.id) || bet!.created_by === me.id) {
      failTo("/bets", { message: "Only someone else in the bet can accept it" });
    }
    const { error } = await supabase
      .from("bets").update({ status: "active", accepted_by: me.id }).eq("id", betId).eq("status", "pending");
    failTo("/bets", error);
    revalidatePath("/bets");
  }

  async function declineBet(formData: FormData) {
    "use server";
    const supabase = createClient();
    const me = await getActor(supabase);
    const betId = formData.get("bet_id") as string;
    const { data: bet } = await supabase
      .from("bets").select("status, created_by, bet_participants(player_id)").eq("id", betId).single();
    const parts = (bet?.bet_participants ?? []) as { player_id: string }[];
    if (!bet || bet.status !== "pending") failTo("/bets", { message: "Bet is no longer pending" });
    if (!parts.some((p) => p.player_id === me.id) && !me.admin) {
      failTo("/bets", { message: "Only someone in the bet can decline it" });
    }
    const { error } = await supabase
      .from("bets").update({ status: "void" }).eq("id", betId).eq("status", "pending");
    failTo("/bets", error);
    revalidatePath("/bets");
  }

  async function closeBet(formData: FormData) {
    "use server";
    const supabase = createClient();
    const me = await getActor(supabase);
    const betId = formData.get("bet_id") as string;
    const winner = formData.get("winner") as string; // side1 | side2 | push | <player_id>

    const { data: betRaw } = await supabase
      .from("bets")
      .select("status, bet_type, bet_participants(id, player_id, side)")
      .eq("id", betId)
      .single();
    const bet = betRaw as unknown as {
      status: string; bet_type: string;
      bet_participants: { id: string; player_id: string; side: number | null }[];
    } | null;
    if (!bet || bet.status !== "active") failTo("/bets", { message: "Bet isn't active" });
    const parts = bet!.bet_participants;
    if (!parts.some((p) => p.player_id === me.id) && !me.admin) {
      failTo("/bets", { message: "Only someone in the bet can close it" });
    }

    if (winner === "push") {
      const { error } = await supabase
        .from("bets")
        .update({ status: "push", closed_by: me.id, closed_at: new Date().toISOString() })
        .eq("id", betId).eq("status", "active");
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
      .eq("id", betId).eq("status", "active");
    failTo("/bets", error);
    await recordBetClosed(supabase, betId); // best-effort feed post
    revalidatePath("/bets");
    revalidatePath("/");
  }

  async function adminReopen(formData: FormData) {
    "use server";
    const supabase = createClient();
    const me = await getActor(supabase);
    if (!me.admin) failTo("/bets", { message: "Admins only" });
    const { error } = await supabase
      .from("bets")
      .update({ status: "active", closed_by: null, closed_at: null })
      .eq("id", formData.get("bet_id") as string)
      .in("status", ["closed", "push"]);
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
    const isPart = b.bet_participants.some((p) => p.player_id === player.id);
    const isCreator = b.created_by === player.id;
    const winners = b.bet_participants.filter((p) => p.is_winner === true);

    return (
      <div className="rounded-xl border border-hairline bg-white p-3 space-y-2">
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

        {/* Pending controls */}
        {b.status === "pending" && (
          <div className="flex items-center gap-2 border-t border-hairline pt-2">
            <span className="flex-1 text-[11px] text-navy/40">Waiting for acceptance…</span>
            {isPart && !isCreator && (
              <form action={acceptBet}>
                <input type="hidden" name="bet_id" value={b.id} />
                <button className={`${btn} bg-europe-green text-white`}>Accept</button>
              </form>
            )}
            {(isPart || admin) && (
              <form action={declineBet}>
                <input type="hidden" name="bet_id" value={b.id} />
                <button className={`${btn} border border-usa-red text-usa-red`}>
                  {isCreator ? "Cancel" : "Decline"}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Active: close-out controls for participants/admins */}
        {b.status === "active" && (isPart || admin) && (
          <div className="border-t border-hairline pt-2 space-y-1.5">
            <p className="text-[11px] text-navy/40">Close out — who won?</p>
            <div className="flex flex-wrap gap-1.5">
              {b.bet_type !== "group" ? (
                <>
                  <form action={closeBet}>
                    <input type="hidden" name="bet_id" value={b.id} />
                    <input type="hidden" name="winner" value="side1" />
                    <button className={`${btn} bg-navy text-off-white`}>{sideNames(b, 1)}</button>
                  </form>
                  <form action={closeBet}>
                    <input type="hidden" name="bet_id" value={b.id} />
                    <input type="hidden" name="winner" value="side2" />
                    <button className={`${btn} bg-navy text-off-white`}>{sideNames(b, 2)}</button>
                  </form>
                </>
              ) : (
                <form action={closeBet} className="flex flex-1 items-center gap-1.5">
                  <input type="hidden" name="bet_id" value={b.id} />
                  <select name="winner" required defaultValue=""
                    className="flex-1 rounded-lg border border-hairline bg-white px-2 py-1.5 text-xs text-navy">
                    <option value="" disabled>Winner…</option>
                    {b.bet_participants.map((p) => (
                      <option key={p.id} value={p.player_id}>{pname(p)}</option>
                    ))}
                  </select>
                  <button className={`${btn} bg-navy text-off-white`}>Set</button>
                </form>
              )}
              <form action={closeBet}>
                <input type="hidden" name="bet_id" value={b.id} />
                <input type="hidden" name="winner" value="push" />
                <button className={`${btn} border border-hairline text-navy/60`}>Push</button>
              </form>
            </div>
          </div>
        )}

        {/* Settled */}
        {(b.status === "closed" || b.status === "push") && (
          <div className="flex items-center justify-between border-t border-hairline pt-2">
            <p className="text-xs font-semibold text-navy">
              {b.status === "push" ? "Push — no money moves" : `🏆 ${winners.map(pname).join(" / ")}`}
            </p>
            {admin && (
              <form action={adminReopen}>
                <input type="hidden" name="bet_id" value={b.id} />
                <button className="text-[11px] text-navy/40 underline underline-offset-2">Reopen</button>
              </form>
            )}
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

      <CreateBetForm players={betOptions} meId={player.id} action={createBet} />

      {/* Bets list with filters */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex gap-1.5">
            {([["me", "My bets"], ["all", "All bets"]] as const).map(([w, label]) => (
              <Link key={w} href={flt(w, statusF)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  who === w ? "bg-navy text-off-white border-navy" : "bg-white text-navy/60 border-hairline"
                }`}>
                {label}
              </Link>
            ))}
          </div>
          <div className="flex gap-1.5">
            {([["all", "All"], ["pending", "Pending"], ["open", "Open"], ["settled", "Settled"]] as const).map(([s, label]) => (
              <Link key={s} href={flt(who, s)}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                  statusF === s ? "bg-navy text-off-white border-navy" : "bg-white text-navy/60 border-hairline"
                }`}>
                {label}
              </Link>
            ))}
          </div>
        </div>
        {visible.length === 0 ? (
          <p className="text-sm text-navy/50">
            {who === "me" ? "No bets of yours here — propose one above." : "Nothing here yet."}
          </p>
        ) : (
          <div className="space-y-2">{visible.map((b) => <BetCard key={b.id} b={b} />)}</div>
        )}
      </div>

      {/* Ledger */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy/50">{year} Ledger</p>
        {ledger.length === 0 ? (
          <p className="text-sm text-navy/50">No settled bets yet.</p>
        ) : (
          <div className="rounded-xl border border-hairline bg-white divide-y divide-hairline">
            {ledger.map(([pid, net]) => (
              <Link key={pid} href={`/bets/player/${pid}`}
                className="flex items-center justify-between px-4 py-2.5 hover:bg-parchment transition-colors">
                <span className="text-sm font-semibold text-navy">{labelOf.get(pid)}</span>
                <span className="flex items-center gap-2">
                  <span className={`text-sm font-bold tabular-nums ${net > 0 ? "text-europe-green" : net < 0 ? "text-usa-red" : "text-navy/50"}`}>
                    {fmtNet(net)}
                  </span>
                  <span className="text-navy/25">›</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
