"use client";

import { useState } from "react";
import Link from "next/link";
import { DeleteButton } from "@/components/DeleteButton";

export interface TeamRow { id: string; name: string; color: string; count: number }

/** Event teams with inline name/color edit, roster link, and delete. */
export function EventTeamList({
  eventId,
  teams,
  updateTeam,
  deleteTeam,
}: {
  eventId: string;
  teams: TeamRow[];
  updateTeam: (formData: FormData) => Promise<void>;
  deleteTeam: (formData: FormData) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <>
      {teams.map((team) => {
        const isEditing = editingId === team.id;
        return (
          <div key={team.id} className="space-y-2 rounded-xl border border-hairline bg-white px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: team.color }} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-navy">{team.name}</p>
                  <p className="text-xs text-navy/50">{team.count} player{team.count !== 1 ? "s" : ""}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Link href={`/admin/events/${eventId}/teams/${team.id}`} className="text-sm text-navy/60 hover:text-navy">
                  Manage roster ›
                </Link>
                <button onClick={() => setEditingId(isEditing ? null : team.id)} className="text-sm text-navy/50 hover:text-navy">
                  {isEditing ? "Cancel" : "Edit"}
                </button>
              </div>
            </div>

            {isEditing && (
              <form action={updateTeam} onSubmit={() => setEditingId(null)} className="space-y-2 border-t border-hairline pt-2">
                <input type="hidden" name="team_id" value={team.id} />
                <input name="name" required defaultValue={team.name} placeholder="Team name"
                  className="w-full rounded-lg border border-hairline px-3 py-1.5 text-sm text-navy" />
                <div className="flex items-center gap-3">
                  <label className="text-sm text-navy/60">Color</label>
                  <input name="color" type="color" defaultValue={team.color}
                    className="h-9 w-16 cursor-pointer rounded border border-hairline" />
                </div>
                <div className="flex items-center gap-3">
                  <button type="submit" className="flex-1 rounded-lg bg-navy py-1.5 text-sm font-semibold text-off-white">
                    Save
                  </button>
                  <DeleteButton
                    action={deleteTeam}
                    fields={{ team_id: team.id }}
                    confirm={`Delete team "${team.name}" and all its roster data?`}
                    label="Delete"
                    className="rounded-lg border border-usa-red px-3 py-1.5 text-sm text-usa-red transition-colors hover:bg-usa-red hover:text-white"
                  />
                </div>
              </form>
            )}
          </div>
        );
      })}
    </>
  );
}
