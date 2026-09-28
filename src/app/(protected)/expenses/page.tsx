import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCurrentEvent } from "@/lib/currentEvent";
import Link from "next/link";
import { ErrorBanner } from "@/components/ErrorBanner";
import { ConfirmForm } from "@/components/ConfirmForm";
import { ExpenseExportButtons } from "@/components/ExpenseExportButtons";
import { deleteExpense, togglePaid, setBooksClosed } from "@/lib/expenseActions";
import { ledgerNets } from "@/lib/bets";
import { LocalDate } from "@/components/LocalDate";
import { expenseTotals, fmtDollars, csvCell } from "@/lib/expenses";

export const dynamic = "force-dynamic";

// Trip expenses: the itemized list, the per-person breakout (spent / owe /
// net) and CSV exports that drop straight into the commissioner's sheet.
export default async function ExpensesPage({ searchParams }: { searchParams: { error?: string } }) {
  const me = await requirePlayer();
  const admin = isAdmin(me);
  const supabase = createClient();
  const event = await getCurrentEvent(supabase);

  const empty = (msg: string) => (
    <div className="px-4 py-6 space-y-4">
      <h1 className="text-2xl font-display font-bold text-navy">Expenses</h1>
      <p className="rounded-lg bg-parchment px-4 py-6 text-center text-sm text-navy/50">{msg}</p>
    </div>
  );
  if (!event) return empty("No active event.");

  const [{ data: rowsRaw }, { data: partsRaw }, { data: betsRaw }, { data: paidRaw }, { data: evRaw }] = await Promise.all([
    supabase.from("expenses")
      .select("id, paid_by, description, amount, split_kind, created_by, created_at, expense_shares(player_id)")
      .eq("event_id", event.id).order("created_at", { ascending: false }),
    supabase.from("event_participants").select("player_id, display_name, players(name, nickname), teams(name)").eq("event_id", event.id),
    // Betting net for the year folds into the house balance (the sheet's last column)
    supabase.from("bets").select("status, amount, bet_participants(player_id, is_winner)").eq("year", event.year).neq("status", "void"),
    supabase.from("event_settlements").select("player_id, paid_at").eq("event_id", event.id),
    supabase.from("events").select("books_closed_at").eq("id", event.id).single(),
  ]);
  const betNet = ledgerNets(((betsRaw ?? []) as unknown as { status: string; amount: number; bet_participants: { player_id: string; is_winner: boolean | null }[] }[])
    .map((b) => ({ ...b, amount: Number(b.amount) })));
  const paidAt = new Map((paidRaw ?? []).map((r) => [r.player_id as string, r.paid_at as string]));
  const booksClosedAt = (evRaw as { books_closed_at: string | null } | null)?.books_closed_at ?? null;
  type Row = {
    id: string; paid_by: string; description: string; amount: number; split_kind: string;
    created_by: string | null; created_at: string; expense_shares: { player_id: string }[];
  };
  const rows = (rowsRaw ?? []) as unknown as Row[];
  const parts = (partsRaw ?? []) as unknown as {
    player_id: string | null; display_name: string;
    players: { name: string; nickname: string | null } | null; teams: { name: string } | null;
  }[];
  const nameOf = new Map<string, string>();
  const teamOf = new Map<string, string>();
  for (const p of parts) {
    if (!p.player_id) continue;
    nameOf.set(p.player_id, p.players?.nickname ?? p.players?.name ?? p.display_name);
    if (p.teams?.name) teamOf.set(p.player_id, p.teams.name.trim());
  }
  const label = (id: string) => nameOf.get(id) ?? "?";
  const groupLabel = (r: Row) =>
    r.split_kind === "all" ? "All"
    : r.split_kind === "usa" ? "USA"
    : r.split_kind === "europe" ? "Europe"
    : r.expense_shares.map((s) => label(s.player_id)).sort().join(", ");

  const totals = expenseTotals(rows.map((r) => ({ paid_by: r.paid_by, amount: Number(r.amount), shares: r.expense_shares.map((s) => s.player_id) })));
  const grand = rows.reduce((n, r) => n + Number(r.amount), 0);
  const people = Array.from(nameOf.keys())
    .map((id) => {
      const t = totals.get(id) ?? { spent: 0, owe: 0, net: 0 };
      const bets = Math.round((betNet.get(id) ?? 0) * 100) / 100;
      return { id, name: label(id), ...t, bets, house: Math.round((t.net + bets) * 100) / 100, paid: paidAt.get(id) ?? null };
    })
    .sort((a, b) => b.house - a.house);
  const mine = people.find((p) => p.id === me.id) ?? { spent: 0, owe: 0, net: 0, bets: 0, house: 0, paid: null };
  const outstanding = people.filter((p) => Math.abs(p.house) >= 0.005 && !p.paid);

  // CSVs shaped like the commissioner's sheet (Person, Description, Amount, Group)
  const itemized = [
    ["Person", "Description", "Amount", "Group", "Split between", "# People", "Per person", "Logged"].join(","),
    ...[...rows].reverse().map((r) => [
      label(r.paid_by), r.description, Number(r.amount).toFixed(2), groupLabel(r),
      r.expense_shares.map((s) => label(s.player_id)).sort().join(", "), r.expense_shares.length,
      (Number(r.amount) / Math.max(r.expense_shares.length, 1)).toFixed(2), r.created_at.slice(0, 10),
    ].map(csvCell).join(",")),
  ].join("\n");
  const breakout = [
    ["Person", "Team", "Spent", "Owe", "Expense net", "Betting net", "House balance", "Paid"].join(","),
    ...people.map((p) => [p.name, teamOf.get(p.id) ?? "", p.spent.toFixed(2), p.owe.toFixed(2), p.net.toFixed(2), p.bets.toFixed(2), p.house.toFixed(2), p.paid ? "yes" : ""].map(csvCell).join(",")),
  ].join("\n");

  const netColor = (n: number) => (n > 0.005 ? "text-europe-green" : n < -0.005 ? "text-usa-red" : "text-navy/50");

  return (
    <div className="px-4 py-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy">Expenses</h1>
          <p className="text-sm text-navy/50">{event.name} · {fmtDollars(grand)} logged</p>
        </div>
        <div className="text-right">
          <p className={`font-display text-2xl font-bold ${netColor(mine.house)}`}>{mine.house > 0 ? "+" : ""}{fmtDollars(mine.house)}</p>
          <p className="text-[10px] uppercase tracking-wide text-navy/40">{mine.paid ? "settled ✓" : "you & the house"}</p>
        </div>
      </div>

      <ErrorBanner message={searchParams.error} />

      {booksClosedAt ? (
        <div className="rounded-xl border border-gold bg-gold/10 px-4 py-3 text-sm text-navy">
          <p className="font-semibold">📕 Books closed <LocalDate iso={booksClosedAt} options={{ month: "short", day: "numeric", year: "numeric" }} /></p>
          <p className="text-xs text-navy/60">{event.year} is settled. Next year&rsquo;s event starts fresh.</p>
          {admin && (
            <ConfirmForm action={setBooksClosed} confirm="Reopen the books? Expenses can be added again." className="mt-2">
              <input type="hidden" name="close" value="0" />
              <button type="submit" className="text-xs font-semibold text-navy/60 underline">Reopen</button>
            </ConfirmForm>
          )}
        </div>
      ) : (
        <Link href="/expenses/new" className="block rounded-xl bg-navy py-3.5 text-center text-base font-semibold text-off-white">
          + Add an expense
        </Link>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg bg-parchment px-4 py-6 text-center text-sm text-navy/50">
          Nothing logged yet. Paid for something for the group? Add it above.
        </p>
      ) : (
        <>
          {/* Settle up: one number per person (expenses + bets), Paid marks, close the books */}
          <div className="rounded-xl border border-gold/60 bg-white overflow-hidden">
            <div className="flex items-center justify-between bg-gold/15 px-3 py-2">
              <p className="text-sm font-bold text-navy">💵 Settle up</p>
              <p className="text-[10px] text-navy/50">{outstanding.length === 0 ? "everyone's square" : `${outstanding.length} outstanding`}</p>
            </div>
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-navy/50">
              <span>Person</span><span className="w-14 text-right">Expenses</span><span className="w-14 text-right">Bets</span><span className="w-16 text-right">House</span><span className="w-12 text-right">Paid</span>
            </div>
            {people.map((p) => (
              <div key={p.id} className={`grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-2 border-t border-hairline px-3 py-1.5 text-sm ${p.id === me.id ? "bg-gold/10" : ""} ${p.paid ? "opacity-60" : ""}`}>
                <span className="font-semibold text-navy truncate">{p.name}</span>
                <span className="w-14 text-right text-xs tabular-nums text-navy/60">{fmtDollars(p.net)}</span>
                <span className="w-14 text-right text-xs tabular-nums text-navy/60">{fmtDollars(p.bets)}</span>
                <span className={`w-16 text-right tabular-nums font-bold ${netColor(p.house)}`}>{p.house > 0 ? "+" : ""}{fmtDollars(p.house)}</span>
                <span className="w-12 text-right">
                  {admin ? (
                    <form action={togglePaid}>
                      <input type="hidden" name="player_id" value={p.id} />
                      <input type="hidden" name="paid" value={p.paid ? "0" : "1"} />
                      <button type="submit" aria-label={p.paid ? "Mark unpaid" : "Mark paid"}
                        className={`h-6 w-6 rounded-full border text-xs font-bold ${p.paid ? "border-europe-green bg-europe-green text-white" : "border-hairline bg-white text-navy/30"}`}>
                        ✓
                      </button>
                    </form>
                  ) : (
                    <span className={`text-xs font-bold ${p.paid ? "text-europe-green" : "text-navy/25"}`}>{p.paid ? "✓" : "–"}</span>
                  )}
                </span>
              </div>
            ))}
            <p className="px-3 py-2 text-[11px] text-navy/40">
              House = expenses + bets. Green: the house owes you. Red: you owe the house. {admin ? "Tap ✓ as money comes in." : ""}
            </p>
            {admin && !booksClosedAt && (
              <div className="border-t border-hairline px-3 py-2">
                <ConfirmForm action={setBooksClosed}
                  confirm={outstanding.length === 0
                    ? `Close the books for ${event.year}? No more expenses can be added.`
                    : `${outstanding.length} people aren't marked paid yet. Close the books anyway?`}>
                  <input type="hidden" name="close" value="1" />
                  <button type="submit" className="w-full rounded-lg border border-navy py-2 text-sm font-semibold text-navy">
                    📕 Close the books for {event.year}
                  </button>
                </ConfirmForm>
              </div>
            )}
          </div>

          {/* Per-person breakout */}
          <div className="rounded-xl border border-hairline bg-white overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 bg-parchment px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-navy/50">
              <span>Person</span><span className="text-right w-16">Spent</span><span className="text-right w-16">Owe</span><span className="text-right w-16">Net</span>
            </div>
            {people.map((p) => (
              <div key={p.id} className={`grid grid-cols-[1fr_auto_auto_auto] gap-x-3 border-t border-hairline px-3 py-2 text-sm ${p.id === me.id ? "bg-gold/10" : ""}`}>
                <span className="font-semibold text-navy truncate">{p.name}</span>
                <span className="w-16 text-right tabular-nums text-navy/70">{fmtDollars(p.spent)}</span>
                <span className="w-16 text-right tabular-nums text-navy/70">{fmtDollars(p.owe)}</span>
                <span className={`w-16 text-right tabular-nums font-bold ${netColor(p.net)}`}>{p.net > 0 ? "+" : ""}{fmtDollars(p.net)}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-navy/40">Net = spent − your share of everything you&rsquo;re in. Green is owed money; red owes.</p>

          {admin && (
            <div className="space-y-2">
              <ExpenseExportButtons itemized={itemized} breakout={breakout} year={event.year} />
              <p className="text-[11px] text-navy/40">Columns match the expenses sheet — open the CSV in Sheets and paste it in.</p>
            </div>
          )}

          {/* Itemized */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-navy/50">{rows.length} expense{rows.length === 1 ? "" : "s"}</p>
            {rows.map((r) => {
              const canDelete = admin || r.paid_by === me.id || r.created_by === me.id;
              const n = r.expense_shares.length;
              return (
                <div key={r.id} className="rounded-xl border border-hairline bg-white px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-navy truncate">{r.description}</p>
                      <p className="text-xs text-navy/60">
                        <span className="font-semibold">{label(r.paid_by)}</span> paid · split {n} way{n === 1 ? "" : "s"} · {fmtDollars(Number(r.amount) / Math.max(n, 1))} each
                      </p>
                      <p className="mt-0.5 text-[11px] text-navy/40 truncate">{groupLabel(r)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-display text-lg font-bold text-navy tabular-nums">{fmtDollars(Number(r.amount))}</p>
                      {canDelete && (
                        <ConfirmForm action={deleteExpense} confirm={`Delete "${r.description}" (${fmtDollars(Number(r.amount))})?`}>
                          <input type="hidden" name="expense_id" value={r.id} />
                          <button type="submit" className="text-[11px] text-usa-red hover:underline">Delete</button>
                        </ConfirmForm>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
