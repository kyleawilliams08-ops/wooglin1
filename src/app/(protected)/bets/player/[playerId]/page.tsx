import { requirePlayer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { betNets, fmtNet } from "@/lib/bets";
import { PlayerBetList, type PlayerBetRow } from "@/components/PlayerBetList";

interface BetPart {
  player_id: string;
  side: number | null;
  is_winner: boolean | null;
  players: { nickname: string | null; name: string } | null;
}
interface Bet {
  id: string;
  bet_type: "h2h" | "teams" | "group";
  amount: number;
  description: string | null;
  status: string;
  created_at: string;
  bet_participants: BetPart[];
}

const pname = (p: BetPart) => p.players?.nickname ?? p.players?.name ?? "?";

// Per-player bet audit trail for the current year's fund.
export default async function BetPlayerPage({
  params,
}: {
  params: { playerId: string };
}) {
  await requirePlayer();
  const supabase = createClient();
  const year = new Date().getFullYear();

  const { data: subject } = await supabase
    .from("players").select("id, name, nickname").eq("id", params.playerId).single();
  if (!subject) redirect("/bets");

  // Bets this player is in, for the year
  const { data: partRows } = await supabase
    .from("bet_participants")
    .select("bet_id")
    .eq("player_id", params.playerId);
  const betIds = (partRows ?? []).map((r) => r.bet_id);

  const { data: betsRaw } = betIds.length > 0
    ? await supabase
        .from("bets")
        .select("id, bet_type, amount, description, status, created_at, bet_participants(player_id, side, is_winner, players(nickname, name))")
        .in("id", betIds)
        .eq("year", year)
        .neq("status", "void")
        .order("created_at", { ascending: false })
    : { data: [] };
  const bets = (betsRaw ?? []) as unknown as Bet[];

  const participantsLine = (b: Bet) =>
    b.bet_type === "group"
      ? b.bet_participants.map(pname).join(" · ")
      : `${b.bet_participants.filter((p) => p.side === 1).map(pname).join(" / ")} vs ${b.bet_participants.filter((p) => p.side === 2).map(pname).join(" / ")}`;

  const statusChip: Record<string, string> = {
    pending: "Pending", active: "Open", closed: "Settled", push: "Push", protested: "Protested",
  };

  const rows: PlayerBetRow[] = bets.map((b) => ({
    id: b.id,
    title: b.description || (b.bet_type === "group" ? "Group bet" : b.bet_type === "teams" ? "2 v 2" : "1 on 1"),
    participants: participantsLine(b),
    statusLabel: statusChip[b.status] ?? b.status,
    stake: Number(b.amount),
    net: betNets({ ...b, amount: Number(b.amount) }).get(params.playerId) ?? 0,
    settled: b.status === "closed",
  }));
  const total = rows.reduce((sum, r) => sum + r.net, 0);

  return (
    <div className="px-4 py-6 space-y-4">
      <Link href="/bets" className="text-sm text-navy/50 hover:text-navy">← Betting</Link>

      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy">
            {subject.nickname ?? subject.name}
          </h1>
          <p className="text-sm text-navy/50 mt-0.5">{year} betting record</p>
        </div>
        <div className="text-right">
          <p className={`text-xl font-bold tabular-nums ${total > 0 ? "text-europe-green" : total < 0 ? "text-usa-red" : "text-navy"}`}>
            {fmtNet(total)}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-navy/40">Net</p>
        </div>
      </div>

      <PlayerBetList rows={rows} />
    </div>
  );
}
