"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";

export interface WizardPlayer {
  id: string;
  label: string;
  avatarUrl: string | null;
}

type BetType = "h2h" | "teams" | "group";
type Step = "type" | "partner" | "opponents" | "amount" | "desc";

const QUICK_BETS = ["CTP", "Long drive", "Low net", "Cornhole", "Pool", "Shuffleboard", "Snake (3-putt)", "Poker"];
const QUICK_AMOUNTS = ["2", "5", "10"];

const stepsFor = (type: BetType): Step[] =>
  type === "teams"
    ? ["type", "partner", "opponents", "amount", "desc"]
    : ["type", "opponents", "amount", "desc"];

function initials(label: string) {
  return label.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

/** Alphabetical tappable player cards with a search box. */
function PlayerGrid({
  options,
  selected,
  onTap,
}: {
  options: WizardPlayer[];
  selected: string[];
  onTap: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;

  return (
    <div className="space-y-3">
      <input
        type="search"
        placeholder="Search…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm text-navy placeholder:text-navy/35 focus:border-navy focus:outline-none"
      />
      <div className="grid grid-cols-3 gap-2">
        {filtered.map((p) => {
          const on = selected.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onTap(p.id)}
              className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition-colors ${
                on ? "border-navy bg-navy" : "border-hairline bg-white active:bg-parchment"
              }`}
            >
              {p.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.avatarUrl} alt="" className="h-11 w-11 rounded-full object-cover ring-1 ring-gold/60" />
              ) : (
                <span className={`flex h-11 w-11 items-center justify-center rounded-full text-xs font-bold ring-1 ring-gold/60 ${
                  on ? "bg-off-white text-navy" : "bg-navy text-off-white"
                }`}>
                  {initials(p.label)}
                </span>
              )}
              <span className={`w-full truncate text-center text-xs font-semibold ${on ? "text-off-white" : "text-navy"}`}>
                {p.label}
              </span>
            </button>
          );
        })}
      </div>
      {filtered.length === 0 && <p className="text-sm text-navy/50">No one matches &ldquo;{q}&rdquo;.</p>}
    </div>
  );
}

/** One-tap-per-page bet proposal flow. */
export function BetWizard({
  players,
  action,
}: {
  players: WizardPlayer[]; // excludes the proposer
  action: (formData: FormData) => Promise<void>;
}) {
  const [type, setType] = useState<BetType>("h2h");
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [partner, setPartner] = useState<string | null>(null);
  const [opponents, setOpponents] = useState<string[]>([]);
  const [amount, setAmount] = useState<string>("");
  const [otherAmount, setOtherAmount] = useState(false);
  const [desc, setDesc] = useState("");
  const [isPending, startTransition] = useTransition();
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const steps = stepsFor(type);
  const step = steps[Math.min(idx, steps.length - 1)];

  const go = (delta: 1 | -1, delay = 0) => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    const move = () => {
      setDir(delta);
      setIdx((i) => Math.max(0, Math.min(i + delta, steps.length - 1)));
    };
    if (delay > 0) advanceTimer.current = setTimeout(move, delay);
    else move();
  };

  const pickType = (t: BetType) => {
    setType(t);
    setPartner(null);
    setOpponents([]);
    setDir(1);
    setIdx(1);
  };

  const opponentOptions = players.filter((p) => p.id !== partner);

  const tapOpponent = (id: string) => {
    if (type === "h2h") {
      setOpponents([id]);
      go(1, 180);
      return;
    }
    setOpponents((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (type === "teams") {
        const capped = next.slice(-2); // last two taps win
        if (capped.length === 2 && !prev.includes(id)) go(1, 220);
        return capped;
      }
      return next;
    });
  };

  const pickAmount = (a: string) => {
    setOtherAmount(false);
    setAmount(a);
    go(1, 180);
  };

  const submit = () => {
    const fd = new FormData();
    fd.set("bet_type", type);
    fd.set("amount", amount);
    fd.set("description", desc);
    if (type === "h2h") fd.set("opponent", opponents[0] ?? "");
    if (type === "teams") {
      fd.set("partner", partner ?? "");
      fd.set("opp1", opponents[0] ?? "");
      fd.set("opp2", opponents[1] ?? "");
    }
    if (type === "group") for (const id of opponents) fd.append("group_ids", id);
    startTransition(() => { void action(fd); });
  };

  const titles: Record<Step, string> = {
    type: "What kind of bet?",
    partner: "Who's your partner?",
    opponents:
      type === "h2h" ? "Who's your opponent?"
      : type === "teams" ? "Pick your 2 opponents"
      : "Who's in? (pick 2+)",
    amount: "How much? (per person)",
    desc: "What's the bet?",
  };

  const bigBtn = "w-full rounded-xl border border-hairline bg-white py-4 text-base font-semibold text-navy active:bg-parchment";

  return (
    <div className="px-4 py-5 space-y-4">
      {/* Header: back / cancel + progress */}
      <div className="flex items-center justify-between">
        {idx === 0 ? (
          <Link href="/bets" className="text-sm text-navy/50 hover:text-navy">← Cancel</Link>
        ) : (
          <button type="button" onClick={() => go(-1)} className="text-sm text-navy/50 hover:text-navy">
            ← Back
          </button>
        )}
        <div className="flex gap-1.5">
          {steps.map((s, i) => (
            <span key={s} className={`h-1.5 w-6 rounded-full ${i <= idx ? "bg-gold" : "bg-hairline"}`} />
          ))}
        </div>
      </div>

      {/* Step content — keyed for the slide animation */}
      <div key={`${type}-${step}`} className={`space-y-4 ${dir === 1 ? "hole-in-fwd" : "hole-in-back"}`}>
        <h1 className="font-display text-2xl font-bold text-navy">{titles[step]}</h1>

        {step === "type" && (
          <div className="space-y-2.5">
            <button type="button" className={bigBtn} onClick={() => pickType("h2h")}>
              1 on 1 <span className="block text-xs font-normal text-navy/50">You vs one opponent</span>
            </button>
            <button type="button" className={bigBtn} onClick={() => pickType("teams")}>
              2 v 2 <span className="block text-xs font-normal text-navy/50">You + partner vs two opponents</span>
            </button>
            <button type="button" className={bigBtn} onClick={() => pickType("group")}>
              Group <span className="block text-xs font-normal text-navy/50">Everyone antes, winner takes all</span>
            </button>
          </div>
        )}

        {step === "partner" && (
          <PlayerGrid
            options={players}
            selected={partner ? [partner] : []}
            onTap={(id) => {
              setPartner(id);
              setOpponents((prev) => prev.filter((x) => x !== id));
              go(1, 180);
            }}
          />
        )}

        {step === "opponents" && (
          <>
            <PlayerGrid options={opponentOptions} selected={opponents} onTap={tapOpponent} />
            {type === "group" && (
              <button
                type="button"
                disabled={opponents.length < 2}
                onClick={() => go(1)}
                className="w-full rounded-xl bg-navy py-3 text-sm font-semibold text-off-white disabled:opacity-40"
              >
                Next ({opponents.length + 1} in the pot)
              </button>
            )}
          </>
        )}

        {step === "amount" && (
          <div className="space-y-2.5">
            <div className="grid grid-cols-3 gap-2.5">
              {QUICK_AMOUNTS.map((a) => (
                <button key={a} type="button" onClick={() => pickAmount(a)}
                  className="rounded-xl border border-hairline bg-white py-5 text-xl font-bold text-navy active:bg-parchment">
                  ${a}
                </button>
              ))}
            </div>
            {otherAmount ? (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-navy/40">$</span>
                  <input
                    type="number" min="1" step="1" inputMode="numeric" autoFocus
                    value={amount} onChange={(e) => setAmount(e.target.value)}
                    className="w-full rounded-xl border border-hairline bg-white px-3 py-3 pl-7 text-base text-navy"
                  />
                </div>
                <button type="button" disabled={!(parseFloat(amount) > 0)} onClick={() => go(1)}
                  className="rounded-xl bg-navy px-5 text-sm font-semibold text-off-white disabled:opacity-40">
                  Next
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => { setAmount(""); setOtherAmount(true); }}
                className="w-full rounded-xl border border-dashed border-hairline py-3 text-sm font-semibold text-navy/60">
                Other amount…
              </button>
            )}
          </div>
        )}

        {step === "desc" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {QUICK_BETS.map((q) => (
                <button key={q} type="button" onClick={() => setDesc(q)}
                  className={`rounded-full border px-3.5 py-2 text-sm font-semibold ${
                    desc === q ? "border-navy bg-navy text-off-white" : "border-hairline bg-white text-navy/70"
                  }`}>
                  {q}
                </button>
              ))}
            </div>
            <input
              value={desc} onChange={(e) => setDesc(e.target.value)}
              placeholder="…or type your own"
              className="w-full rounded-xl border border-hairline bg-white px-4 py-3 text-sm text-navy"
            />
            <button
              type="button"
              onClick={submit}
              disabled={isPending}
              className="w-full rounded-xl bg-europe-green py-3.5 text-base font-semibold text-white disabled:opacity-50"
            >
              {isPending ? "Proposing…" : `Propose Bet — $${amount || "?"}`}
            </button>
            <p className="text-center text-[11px] text-navy/40">
              Goes live once someone in the bet accepts it.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
