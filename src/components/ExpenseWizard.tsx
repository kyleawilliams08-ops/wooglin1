"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { PlayerGrid, type WizardPlayer } from "@/components/BetWizard";

export type SplitKind = "all" | "usa" | "europe" | "custom";
type Step = "payer" | "amount" | "desc" | "group" | "people";

const QUICK_DESCS = ["Groceries", "Liquor store", "Dinner", "Lunch", "Tip", "Transportation", "Supplies"];

/**
 * One-tap-per-page expense entry: who paid → amount → what → who splits it
 * (All / USA / Europe / Custom → pick people). Same feel as the bet wizard.
 */
export function ExpenseWizard({
  players,
  me,
  teamNames,
  action,
}: {
  players: WizardPlayer[];        // everyone on the trip
  me: string;                     // player id — default payer
  teamNames: { usa: string | null; europe: string | null };
  action: (formData: FormData) => Promise<void>;
}) {
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [payer, setPayer] = useState<string>(me);
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [kind, setKind] = useState<SplitKind | null>(null);
  const [people, setPeople] = useState<string[]>(players.map((p) => p.id)); // custom starts from everyone
  const [isPending, startTransition] = useTransition();

  const steps: Step[] = kind === "custom"
    ? ["payer", "amount", "desc", "group", "people"]
    : ["payer", "amount", "desc", "group"];
  const step = steps[Math.min(idx, steps.length - 1)];
  const go = (d: 1 | -1) => { setDir(d); setIdx((i) => Math.max(0, Math.min(i + d, steps.length - 1))); };

  const amountOk = parseFloat(amount) > 0;
  const submit = (k: SplitKind, ids?: string[]) => {
    const fd = new FormData();
    fd.set("paid_by", payer);
    fd.set("amount", amount);
    fd.set("description", desc.trim());
    fd.set("split_kind", k);
    if (k === "custom") for (const id of ids ?? people) fd.append("share_ids", id);
    startTransition(() => { void action(fd); });
  };

  const titles: Record<Step, string> = {
    payer: "Who paid?",
    amount: "How much?",
    desc: "What was it?",
    group: "Split between who?",
    people: "Pick the people",
  };
  const payerLabel = players.find((p) => p.id === payer)?.label ?? "?";
  const big = "w-full rounded-xl border border-hairline bg-white py-4 text-base font-semibold text-navy active:bg-parchment";

  return (
    <div className="px-4 py-5 space-y-4">
      <div className="flex items-center justify-between">
        {idx === 0 ? (
          <Link href="/expenses" className="text-sm text-navy/50 hover:text-navy">← Cancel</Link>
        ) : (
          <button type="button" onClick={() => go(-1)} className="text-sm text-navy/50 hover:text-navy">← Back</button>
        )}
        <div className="flex gap-1.5">
          {steps.map((s, i) => <span key={s} className={`h-1.5 w-6 rounded-full ${i <= idx ? "bg-gold" : "bg-hairline"}`} />)}
        </div>
      </div>

      <div key={step} className={`space-y-4 ${dir === 1 ? "hole-in-fwd" : "hole-in-back"}`}>
        <h1 className="font-display text-2xl font-bold text-navy">{titles[step]}</h1>

        {step === "payer" && (
          <>
            <button type="button" onClick={() => go(1)}
              className="w-full rounded-xl bg-navy py-4 text-base font-semibold text-off-white">
              {payer === me ? "I did" : payerLabel} →
            </button>
            <p className="text-xs text-navy/40">…or tap whoever picked up the tab:</p>
            <PlayerGrid options={players} selected={[payer]} onTap={(id) => { setPayer(id); setDir(1); setIdx(1); }} />
          </>
        )}

        {step === "amount" && (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-navy/40">$</span>
              <input
                type="text" inputMode="decimal" autoFocus placeholder="0.00"
                value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter" && amountOk) go(1); }}
                className="w-full rounded-xl border border-hairline bg-white px-3 py-3 pl-7 text-lg text-navy"
              />
            </div>
            <button type="button" disabled={!amountOk} onClick={() => go(1)}
              className="rounded-xl bg-navy px-5 text-sm font-semibold text-off-white disabled:opacity-40">
              Next
            </button>
          </div>
        )}

        {step === "desc" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {QUICK_DESCS.map((q) => (
                <button key={q} type="button" onClick={() => setDesc(q)}
                  className={`rounded-full border px-3.5 py-2 text-sm font-semibold ${
                    desc === q ? "border-navy bg-navy text-off-white" : "border-hairline bg-white text-navy/70"
                  }`}>
                  {q}
                </button>
              ))}
            </div>
            <input
              value={desc} onChange={(e) => setDesc(e.target.value)} autoFocus
              placeholder="e.g. Food Lion run, Hibachi dinner, Starter tip"
              onKeyDown={(e) => { if (e.key === "Enter" && desc.trim()) go(1); }}
              className="w-full rounded-xl border border-hairline bg-white px-4 py-3 text-sm text-navy"
            />
            <button type="button" disabled={!desc.trim()} onClick={() => go(1)}
              className="w-full rounded-xl bg-navy py-3.5 text-base font-semibold text-off-white disabled:opacity-40">
              Next
            </button>
          </div>
        )}

        {step === "group" && (
          <div className="space-y-2.5">
            <button type="button" disabled={isPending} onClick={() => { setKind("all"); submit("all"); }} className={big}>
              Everyone <span className="block text-xs font-normal text-navy/50">{players.length} people</span>
            </button>
            {teamNames.usa && (
              <button type="button" disabled={isPending} onClick={() => { setKind("usa"); submit("usa"); }}
                className="w-full rounded-xl border border-hairline bg-white py-4 text-base font-semibold text-usa-red active:bg-parchment">
                {teamNames.usa} only
              </button>
            )}
            {teamNames.europe && (
              <button type="button" disabled={isPending} onClick={() => { setKind("europe"); submit("europe"); }}
                className="w-full rounded-xl border border-hairline bg-white py-4 text-base font-semibold text-europe-green active:bg-parchment">
                {teamNames.europe} only
              </button>
            )}
            <button type="button" onClick={() => { setKind("custom"); setDir(1); setIdx(4); }} className={big}>
              Custom… <span className="block text-xs font-normal text-navy/50">pick who&rsquo;s in</span>
            </button>
            {isPending && <p className="text-center text-sm text-navy/50">Saving…</p>}
          </div>
        )}

        {step === "people" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <p className="text-navy/50">{people.length} of {players.length} selected — tap to toggle</p>
              <span className="flex gap-3">
                <button type="button" onClick={() => setPeople(players.map((p) => p.id))} className="font-semibold text-navy/60 underline">All</button>
                <button type="button" onClick={() => setPeople([])} className="font-semibold text-navy/60 underline">None</button>
              </span>
            </div>
            <PlayerGrid options={players} selected={people}
              onTap={(id) => setPeople((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))} />
            <button type="button" disabled={isPending || people.length === 0} onClick={() => submit("custom")}
              className="w-full rounded-xl bg-europe-green py-3.5 text-base font-semibold text-white disabled:opacity-40">
              {isPending ? "Saving…" : `Save — $${amount} split ${people.length} ways`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
