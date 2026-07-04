"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Dropdown that filters a page by ?year=. "All" clears the param. */
export function YearFilter({ years }: { years: number[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const current = sp.get("year") ?? "all";

  return (
    <select
      value={current}
      onChange={(e) => {
        const v = e.target.value;
        router.replace(v === "all" ? pathname : `${pathname}?year=${v}`, { scroll: false });
      }}
      className="rounded-lg border border-hairline bg-white px-2 py-1.5 text-xs text-navy"
    >
      <option value="all">All years</option>
      {years.map((y) => (
        <option key={y} value={y}>{y}</option>
      ))}
    </select>
  );
}
