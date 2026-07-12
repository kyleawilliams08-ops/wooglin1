"use client";

import { useState } from "react";

export interface CourseTee { id: string; tee_name: string; rating: number; slope: number; par: number }
export interface CourseView { id: string; name: string; location: string | null; course_tees: CourseTee[] }

/** Course directory with a client-side name/location search. */
export function CourseList({ courses }: { courses: CourseView[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? courses.filter((c) => `${c.name} ${c.location ?? ""}`.toLowerCase().includes(needle))
    : courses;

  return (
    <div className="space-y-4">
      <input
        type="search"
        placeholder="Search courses…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm text-navy placeholder:text-navy/35 focus:border-navy focus:outline-none"
      />

      {filtered.length === 0 ? (
        <p className="text-sm text-navy/50">
          {needle ? `No courses match “${q}”.` : "No courses yet."}
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((c) => (
            <li key={c.id} className="rounded-xl border border-hairline bg-white px-4 py-4">
              <p className="font-semibold text-navy">{c.name}</p>
              {c.location && <p className="mt-0.5 text-xs text-navy/50">{c.location}</p>}
              {c.course_tees.length > 0 && (
                <table className="mt-3 w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-navy/40">
                      <th className="pb-1 text-left font-semibold">Tee</th>
                      <th className="pb-1 text-right font-semibold">Rating</th>
                      <th className="pb-1 text-right font-semibold">Slope</th>
                      <th className="pb-1 text-right font-semibold">Par</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.course_tees.map((t) => (
                      <tr key={t.id} className="border-t border-hairline text-navy">
                        <td className="py-1.5">{t.tee_name}</td>
                        <td className="py-1.5 text-right tabular-nums">{t.rating}</td>
                        <td className="py-1.5 text-right tabular-nums">{t.slope}</td>
                        <td className="py-1.5 text-right tabular-nums">{t.par}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
