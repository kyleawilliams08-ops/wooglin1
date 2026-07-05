"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-off-white print:hidden"
    >
      Print / Save as PDF
    </button>
  );
}
