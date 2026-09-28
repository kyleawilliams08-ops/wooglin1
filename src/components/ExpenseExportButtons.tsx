"use client";

import { DownloadTextButton } from "@/components/DownloadTextButton";

/** Itemized + per-person CSVs, built client-side from the rows the page already has. */
export function ExpenseExportButtons({ itemized, breakout, year }: { itemized: string; breakout: string; year: number }) {
  return (
    <div className="flex flex-wrap gap-2">
      <DownloadTextButton text={itemized} filename={`wooglin-${year}-expenses.csv`} label="⬇ Itemized CSV" />
      <DownloadTextButton text={breakout} filename={`wooglin-${year}-expense-breakout.csv`} label="⬇ Per-person CSV" />
    </div>
  );
}
