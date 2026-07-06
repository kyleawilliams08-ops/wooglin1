// Betting fund math. Amount = PER-PERSON stake: every loser pays the stake,
// and the pot splits evenly among winners. This one rule covers 1v1, 2v2,
// and group bets. Pure module — no DB calls.

export interface BetParticipantNet {
  player_id: string;
  is_winner: boolean | null;
}

export interface BetForNet {
  status: string;
  amount: number;
  bet_participants: BetParticipantNet[];
}

/**
 * Per-player net for one bet. Only 'closed' bets move money:
 * losers -amount, winners +(losers × amount ÷ winners).
 * push/void/pending/active → everyone 0.
 */
export function betNets(bet: BetForNet): Map<string, number> {
  const nets = new Map<string, number>();
  for (const p of bet.bet_participants) nets.set(p.player_id, 0);
  if (bet.status !== "closed") return nets;

  const winners = bet.bet_participants.filter((p) => p.is_winner === true);
  const losers = bet.bet_participants.filter((p) => p.is_winner !== true);
  if (winners.length === 0 || losers.length === 0) return nets;

  const pot = losers.length * bet.amount;
  const perWinner = pot / winners.length;
  for (const w of winners) nets.set(w.player_id, perWinner);
  for (const l of losers) nets.set(l.player_id, -bet.amount);
  return nets;
}

/** Season ledger: player → net across all bets. */
export function ledgerNets(bets: BetForNet[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const bet of bets) {
    betNets(bet).forEach((net, pid) => {
      totals.set(pid, (totals.get(pid) ?? 0) + net);
    });
  }
  return totals;
}

/** "$20" / "-$20" / "$26.67" — dollars, cents only when needed. */
export function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const s = Number.isInteger(abs) ? `$${abs}` : `$${abs.toFixed(2)}`;
  return n < 0 ? `-${s}` : s;
}

/** "+$20" for gains, "-$20" for losses, "$0" for even. */
export function fmtNet(n: number): string {
  if (n > 0) return `+${fmtMoney(n)}`;
  return fmtMoney(n);
}
