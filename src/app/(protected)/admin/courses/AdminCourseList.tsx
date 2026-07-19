"use client";

import { useState } from "react";
import Link from "next/link";
import { DeleteButton } from "@/components/DeleteButton";

export interface AdminCourseRow { id: string; name: string; location: string | null; teeCount: number }

/** Admin course list with a client-side name/location search. */
export function AdminCourseList({
  courses,
  deleteCourse,
}: {
  courses: AdminCourseRow[];
  deleteCourse: (formData: FormData) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? courses.filter((c) => `${c.name} ${c.location ?? ""}`.toLowerCase().includes(needle))
    : courses;

  return (
    <div className="space-y-2">
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
        <ul className="space-y-2">
          {filtered.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-xl border border-hairline bg-white px-4 py-4">
              <div className="min-w-0">
                <p className="truncate font-semibold text-navy">{c.name}</p>
                <p className="truncate text-xs text-navy/50">
                  {c.location ? `${c.location} · ` : ""}{c.teeCount} tee set{c.teeCount !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Link href={`/admin/courses/${c.id}`} className="text-sm text-navy/60 hover:text-navy">
                  Manage ›
                </Link>
                <DeleteButton
                  action={deleteCourse}
                  fields={{ id: c.id }}
                  confirm={`Delete "${c.name}" and all its tee and hole data?`}
                  label="Delete"
                  className="text-xs text-usa-red hover:underline"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
