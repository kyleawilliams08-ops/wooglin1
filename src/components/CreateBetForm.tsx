"use client";

import { useState } from "react";

export interface BetPlayerOption {
  id: string;
  label: string;
}

const QUICK_BETS = [
  "Closest to pin",
  "Long drive",
  "Low net",
  "Low gross",
  "First blood",
  "Snake (3-putt)",
  "Sandy",
  "Poker",
];

/**
 * Propose a side bet. The creator is always in the bet: side 1 for
 * 1-on-1/2v2, or one of the field for group bets.
 */
export function CreateBetForm({
  players,
  meId,
  action,
}: {
  players: BetPlayerOption[];
  meId: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const [type, setType] = useState<"h2h" | "teams" | "group">("h2h");
  const [desc, setDesc] = useState("");
  const others = players.filter((p) => p.id !== meId);

  const selectCls = "w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-navy";

  return (
    <form action={action} className="rounded-xl border border-hairline bg-parchment p-4 space-y-3">
      <p className="text-sm font-semibold text-navy">Propose a bet</p>

      <select name="bet_type" value={type} onChange={(e) => setType(e.target.value as typeof type)}
        className={selectCls}>
        <option value="h2h">1 on 1</option>
        <option value="teams">2 v 2</option>
        <option value="group">Group — winner takes all</option>
      </select>

      {type === "h2h" && (
        <select name="opponent" required className={selectCls} defaultValue="">
          <option value="" disabled>Opponent…</option>
          {others.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      )}

      {type === "teams" && (
        <div className="space-y-2">
          <select name="partner" required className={selectCls} defaultValue="">
            <option value="" disabled>Your partner…</option>
            {others.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <select name="opp1" required className={selectCls} defaultValue="">
              <option value="" disabled>Opponent 1…</option>
              {others.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <select name="opp2" required className={selectCls} defaultValue="">
              <option value="" disabled>Opponent 2…</option>
              {others.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {type === "group" && (
        <div className="rounded-lg border border-hairline bg-white px-3 py-2 max-h-44 overflow-y-auto">
          <p className="text-xs text-navy/50 mb-1.5">You&rsquo;re in. Who else has action? (pick 2+)</p>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
            {others.map((p) => (
              <label key={p.id} className="flex items-center gap-1.5 text-sm text-navy">
                <input type="checkbox" name="group_ids" value={p.id} className="accent-[#0C2D55]" />
                <span className="truncate">{p.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-navy/40">$</span>
        <input name="amount" type="number" min="1" step="1" required inputMode="numeric"
          placeholder={type === "group" ? "Stake per player" : "Amount (per person)"}
          className="w-full rounded-lg border border-hairline bg-white px-3 py-2 pl-7 text-sm text-navy" />
      </div>

      <div>
        <input name="description" value={desc} onChange={(e) => setDesc(e.target.value)}
          placeholder="What's the bet?"
          className="w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-navy" />
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {QUICK_BETS.map((q) => (
            <button key={q} type="button" onClick={() => setDesc(q)}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                desc === q ? "border-navy bg-navy text-off-white" : "border-hairline bg-white text-navy/60"
              }`}>
              {q}
            </button>
          ))}
        </div>
      </div>

      <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
        Propose Bet
      </button>
      <p className="text-[11px] text-navy/40 text-center">
        Goes live once someone in the bet accepts it.
      </p>
    </form>
  );
}
