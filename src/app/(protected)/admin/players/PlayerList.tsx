"use client";

import { useState } from "react";
import { DeleteButton } from "@/components/DeleteButton";

interface Player {
  id: string;
  name: string;
  nickname: string | null;
  email: string;
  current_index: number | null;
  hcp_allowance: number;
  role: string;
}

interface Props {
  players: Player[];
  updatePlayer: (formData: FormData) => Promise<void>;
  deletePlayer: (formData: FormData) => Promise<void>;
}

export function PlayerList({ players, updatePlayer, deletePlayer }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <ul className="space-y-2">
      {players.map((p) => {
        const isEditing = editingId === p.id;
        return (
          <li key={p.id} className="rounded-xl border border-hairline bg-white px-4 py-3 space-y-2">
            {/* View row */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-navy">{p.name}</p>
                <p className="text-xs text-navy/50">
                  {p.current_index != null ? `Index ${p.current_index}` : "No index"} · {p.hcp_allowance}% · <span className="uppercase">{p.role}</span>
                </p>
              </div>
              <button
                onClick={() => setEditingId(isEditing ? null : p.id)}
                className="text-sm text-navy/50 hover:text-navy"
              >
                {isEditing ? "Cancel" : "Edit"}
              </button>
            </div>

            {/* Edit form */}
            {isEditing && (
              <div className="space-y-2 pt-1 border-t border-hairline">
                <form action={updatePlayer} onSubmit={() => setEditingId(null)} className="space-y-2">
                  <input type="hidden" name="id" value={p.id} />
                  <input
                    name="name"
                    required
                    defaultValue={p.name}
                    placeholder="Full name"
                    className="w-full rounded-lg border border-hairline px-3 py-1.5 text-sm text-navy"
                  />
                  <input
                    name="email"
                    type="email"
                    required
                    defaultValue={p.email}
                    placeholder="Email"
                    className="w-full rounded-lg border border-hairline px-3 py-1.5 text-sm text-navy"
                  />
                  <div className="flex gap-2">
                    <input
                      name="index"
                      type="number"
                      step="0.1"
                      defaultValue={p.current_index ?? ""}
                      placeholder="USGA Index"
                      className="flex-1 rounded-lg border border-hairline px-3 py-1.5 text-sm text-navy"
                    />
                    <div className="relative flex-1">
                      <input
                        name="hcp_allowance"
                        type="number"
                        min="0"
                        max="100"
                        defaultValue={p.hcp_allowance}
                        placeholder="Allowance %"
                        className="w-full rounded-lg border border-hairline px-3 py-1.5 text-sm text-navy pr-6"
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-navy/40">%</span>
                    </div>
                  </div>
                  <select
                    name="role"
                    defaultValue={p.role}
                    className="w-full rounded-lg border border-hairline px-3 py-1.5 text-sm text-navy bg-white"
                  >
                    <option value="player">Player</option>
                    <option value="captain">Captain</option>
                    <option value="assistant">Assistant</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button type="submit" className="w-full rounded-lg bg-navy py-1.5 text-sm font-semibold text-off-white">
                    Save
                  </button>
                </form>
                <DeleteButton
                  action={deletePlayer}
                  fields={{ id: p.id }}
                  confirm={`Delete ${p.name}? This cannot be undone.`}
                  label="Delete player"
                  className="w-full rounded-lg border border-usa-red px-3 py-1.5 text-sm text-usa-red hover:bg-usa-red hover:text-white transition-colors"
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
