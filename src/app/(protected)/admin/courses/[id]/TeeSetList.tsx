"use client";

import { useState } from "react";
import Link from "next/link";
import { DeleteButton } from "@/components/DeleteButton";

export interface TeeRow {
  id: string;
  tee_name: string;
  rating: number;
  slope: number;
  par: number;
  holeCount: number;
}

const numCls = "rounded-lg border border-hairline px-3 py-1.5 text-sm text-navy";

/** Tee sets with inline edit (name / rating / slope / par), Holes link, delete. */
export function TeeSetList({
  courseId,
  tees,
  updateTee,
  deleteTee,
}: {
  courseId: string;
  tees: TeeRow[];
  updateTee: (formData: FormData) => Promise<void>;
  deleteTee: (formData: FormData) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (tees.length === 0) return <p className="text-sm text-navy/40">No tee sets yet.</p>;

  return (
    <div className="space-y-2">
      {tees.map((tee) => {
        const isEditing = editingId === tee.id;
        return (
          <div key={tee.id} className="space-y-2 rounded-xl border border-hairline bg-white px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="truncate font-semibold text-navy">{tee.tee_name} Tees</p>
                <p className="text-xs text-navy/50">
                  Rating {tee.rating} / Slope {tee.slope} / Par {tee.par} · {tee.holeCount} holes
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Link href={`/admin/courses/${courseId}/tees/${tee.id}`} className="text-sm text-navy/60 hover:text-navy">
                  Holes ›
                </Link>
                <button onClick={() => setEditingId(isEditing ? null : tee.id)} className="text-sm text-navy/50 hover:text-navy">
                  {isEditing ? "Cancel" : "Edit"}
                </button>
              </div>
            </div>

            {isEditing && (
              <form action={updateTee} onSubmit={() => setEditingId(null)} className="space-y-2 border-t border-hairline pt-2">
                <input type="hidden" name="tee_id" value={tee.id} />
                <input name="tee_name" required defaultValue={tee.tee_name} placeholder="Tee name (e.g. Blue)"
                  className="w-full rounded-lg border border-hairline px-3 py-1.5 text-sm text-navy" />
                <div className="grid grid-cols-3 gap-2">
                  <input name="rating" required defaultValue={tee.rating} inputMode="decimal" placeholder="Rating" className={numCls} />
                  <input name="slope" required defaultValue={tee.slope} inputMode="numeric" placeholder="Slope" className={numCls} />
                  <input name="par" required defaultValue={tee.par} inputMode="numeric" placeholder="Par" className={numCls} />
                </div>
                <div className="flex items-center gap-3">
                  <button type="submit" className="flex-1 rounded-lg bg-navy py-1.5 text-sm font-semibold text-off-white">
                    Save
                  </button>
                  <DeleteButton
                    action={deleteTee}
                    fields={{ tee_id: tee.id }}
                    confirm={`Delete "${tee.tee_name}" tees and all hole data?`}
                    label="Delete"
                    className="rounded-lg border border-usa-red px-3 py-1.5 text-sm text-usa-red transition-colors hover:bg-usa-red hover:text-white"
                  />
                </div>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}
