"use client";

import { useState } from "react";

// Golf term for a score relative to par.
const TERMS: Record<number, string> = {
  [-3]: "Albatross",
  [-2]: "Eagle",
  [-1]: "Birdie",
  [0]:  "Par",
  [1]:  "Bogey",
  [2]:  "Double",
  [3]:  "Triple",
  [4]:  "Quad",
};

/**
 * One-tap score entry: the cell is a button that opens a bottom sheet with
 * big thumb-sized buttons centered on par. Keeps a hidden input so the
 * surrounding server-action form reads the value exactly like the old
 * <input type="number"> did.
 */
export function ScoreInput({
  name,
  defaultValue,
  par,
  disabled,
  sheetLabel,
}: {
  name: string;
  defaultValue: number | null;
  par: number;
  disabled?: boolean;
  sheetLabel: string; // e.g. "Hole 4 · Par 4 — Joey"
}) {
  const [value, setValue] = useState<number | null>(defaultValue);
  const [open, setOpen] = useState(false);

  const boxCls = "w-10 h-8 rounded border border-hairline text-center text-sm inline-flex items-center justify-center";

  if (disabled) {
    return (
      <>
        <input type="hidden" name={name} value={value ?? ""} />
        <span className={`${boxCls} bg-parchment text-navy/60`}>{value ?? ""}</span>
      </>
    );
  }

  // Main grid: par−3 … par+4 (clamped to ≥1); extras row for blowups.
  const choices: { score: number; term: string }[] = [];
  for (let d = -3; d <= 4; d++) {
    const score = par + d;
    if (score < 1) continue;
    choices.push({ score, term: TERMS[d] ?? `+${d}` });
  }
  const extras = [par + 5, par + 6, par + 7].filter((s) => s <= 15);

  const pick = (v: number | null) => {
    setValue(v);
    setOpen(false);
  };

  return (
    <>
      <input type="hidden" name={name} value={value ?? ""} />
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${boxCls} bg-white active:bg-parchment ${value == null ? "text-navy/25" : "font-semibold text-navy"}`}
      >
        {value ?? "·"}
      </button>

      {open && (
        <div className="fixed inset-0 z-50" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-white p-4 pb-8 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-center text-sm font-semibold text-navy mb-3">{sheetLabel}</p>

            <div className="grid grid-cols-4 gap-2">
              {choices.map(({ score, term }) => (
                <button
                  key={score}
                  type="button"
                  onClick={() => pick(score)}
                  className={`rounded-xl py-3 flex flex-col items-center border transition-colors ${
                    score === value
                      ? "bg-navy text-white border-navy"
                      : score === par
                      ? "border-navy/60 text-navy bg-parchment"
                      : "border-hairline text-navy bg-white active:bg-parchment"
                  }`}
                >
                  <span className="text-xl font-bold leading-none tabular-nums">{score}</span>
                  <span className={`text-[10px] mt-1 ${score === value ? "text-white/70" : "text-navy/50"}`}>
                    {term}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-2 flex gap-2">
              {extras.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => pick(s)}
                  className={`flex-1 rounded-lg py-2 text-sm tabular-nums border ${
                    s === value ? "bg-navy text-white border-navy" : "border-hairline text-navy bg-white"
                  }`}
                >
                  {s}
                </button>
              ))}
              <button
                type="button"
                onClick={() => pick(null)}
                className="flex-1 rounded-lg py-2 text-sm border border-hairline text-navy/50 bg-white"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
