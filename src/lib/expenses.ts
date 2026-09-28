// Trip-expense math. Pure module — no DB calls. Mirrors the post-trip sheet:
// each expense is split evenly among its share list; the payer is owed the
// rest. Per person: spent (what they paid for), owe (their share of every
// expense they're in), net = spent − owe (+ = the group owes them).

export interface ExpenseForMath {
  paid_by: string;
  amount: number;
  shares: string[]; // player ids the expense is split between
}

export interface PersonTotals { spent: number; owe: number; net: number }

/** Spent / owe / net per player across all expenses. */
export function expenseTotals(expenses: ExpenseForMath[]): Map<string, PersonTotals> {
  const out = new Map<string, PersonTotals>();
  const get = (id: string) => {
    let t = out.get(id);
    if (!t) { t = { spent: 0, owe: 0, net: 0 }; out.set(id, t); }
    return t;
  };
  for (const e of expenses) {
    get(e.paid_by).spent += e.amount;
    const people = Array.from(new Set(e.shares));
    if (people.length === 0) continue;
    const each = e.amount / people.length;
    for (const pid of people) get(pid).owe += each;
  }
  out.forEach((t) => {
    t.spent = round2(t.spent);
    t.owe = round2(t.owe);
    t.net = round2(t.spent - t.owe);
  });
  return out;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** "$1,256.40" */
export function fmtDollars(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${abs}` : `$${abs}`;
}

/** One CSV cell, quoted when it needs to be. */
export function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
