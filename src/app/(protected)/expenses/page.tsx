import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCurrentEvent } from "@/lib/currentEvent";
import Link from "next/link";
import { ErrorBanner } from "@/components/ErrorBanner";
import { ConfirmForm } from "@/components/ConfirmForm";
import { ExpenseExportButtons } from "@/components/ExpenseExportButtons";
import { deleteExpense } from "@/lib/expenseActions";
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

  const [{ data: rowsRaw }, { data: partsRaw }] = await Promise.all([
    supabase.from("expenses")
      .select("id, paid_by, description, amount, split_kind, created_by, created_at, expense_shares(player_id)")
      .eq("event_id", event.id).order("created_at", { ascending: false }),
    supabase.from("event_participants").select("player_id, display_name, players(name, nickname), teams(name)").eq("event_id", event.id),
  ]);
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
    .map((id) => ({ id, name: label(id), ...(totals.get(id) ?? { spent: 0, owe: 0, net: 0 }) }))
    .sort((a, b) => b.net - a.net);
  const mine = totals.get(me.id) ?? { spent: 0, owe: 0, net: 0 };

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
    ["Person", "Team", "Spent", "Owe", "Net"].join(","),
    ...people.map((p) => [p.name, teamOf.get(p.id) ?? "", p.spent.toFixed(2), p.owe.toFixed(2), p.net.toFixed(2)].map(csvCell).join(",")),
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
          <p className={`font-display text-2xl font-bold ${netColor(mine.net)}`}>{mine.net > 0 ? "+" : ""}{fmtDollars(mine.net)}</p>
          <p className="text-[10px] uppercase tracking-wide text-navy/40">your net</p>
        </div>
      </div>

      <ErrorBanner message={searchParams.error} />

      <Link href="/expenses/new" className="block rounded-xl bg-navy py-3.5 text-center text-base font-semibold text-off-white">
        + Add an expense
      </Link>

      {rows.length === 0 ? (
        <p className="rounded-lg bg-parchment px-4 py-6 text-center text-sm text-navy/50">
          Nothing logged yet. Paid for something for the group? Add it above.
        </p>
      ) : (
        <>
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
