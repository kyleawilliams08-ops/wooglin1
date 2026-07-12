"use client";

import { useState } from "react";
import Link from "next/link";

export interface EventRow {
  id: string;
  name: string;
  location: string | null;
  year: number;
  status: string;
}

const statusColor: Record<string, string> = {
  draft: "bg-hairline text-navy/60",
  active: "bg-europe-green/20 text-europe-green",
  complete: "bg-navy/10 text-navy/40",
};

/** Admin events list with a client-side name/location/year search. */
export function EventList({ events }: { events: EventRow[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? events.filter((e) => `${e.name} ${e.location ?? ""} ${e.year}`.toLowerCase().includes(needle))
    : events;

  return (
    <div className="space-y-2">
      <input
        type="search"
        placeholder="Search events…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm text-navy placeholder:text-navy/35 focus:border-navy focus:outline-none"
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-navy/50">
          {needle ? `No events match “${q}”.` : "No events yet."}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((e) => (
            <li key={e.id}>
              <Link href={`/admin/events/${e.id}`}
                className="flex items-center justify-between rounded-xl border border-hairline bg-white px-4 py-4 hover:bg-parchment transition-colors">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-navy">{e.name}</p>
                  <p className="mt-0.5 truncate text-xs text-navy/50">
                    {e.location ? `${e.location} · ` : ""}{e.year}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium uppercase ${statusColor[e.status] ?? ""}`}>
                    {e.status}
                  </span>
                  <span className="text-navy/30">›</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
