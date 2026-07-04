"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DeleteButton } from "@/components/DeleteButton";
import { createClient } from "@/lib/supabase/client";
import { formatHcp } from "@/lib/handicap";

interface Player {
  id: string;
  name: string;
  nickname: string | null;
  email: string;
  current_index: number | null;
  role: string;
  avatar_url: string | null;
}

interface Props {
  players: Player[];
  updatePlayer: (formData: FormData) => Promise<void>;
  deletePlayer: (formData: FormData) => Promise<void>;
}

export function PlayerList({ players, updatePlayer, deletePlayer }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const router = useRouter();

  // Upload straight from the browser: storage write + avatar_url update are
  // both admin-gated by RLS.
  async function uploadAvatar(p: Player, file: File) {
    setUploadingId(p.id);
    const supabase = createClient();
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${p.id}-${Date.now()}.${ext}`; // timestamped path busts CDN caching
    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, file, { cacheControl: "3600" });
    if (upErr) {
      alert(`Upload failed: ${upErr.message}`);
    } else {
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const { error: dbErr } = await supabase
        .from("players")
        .update({ avatar_url: data.publicUrl })
        .eq("id", p.id);
      if (dbErr) alert(`Couldn't save photo: ${dbErr.message}`);
      else router.refresh();
    }
    setUploadingId(null);
  }

  const initials = (p: Player) =>
    (p.nickname ?? p.name).split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <ul className="space-y-2">
      {players.map((p) => {
        const isEditing = editingId === p.id;
        return (
          <li key={p.id} className="rounded-xl border border-hairline bg-white px-4 py-3 space-y-2">
            {/* View row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {p.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.avatar_url} alt={p.name}
                    className="h-10 w-10 rounded-full object-cover ring-1 ring-hairline" />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-navy text-xs font-bold text-off-white">
                    {initials(p)}
                  </span>
                )}
                <div>
                  <p className="font-semibold text-navy">{p.name}</p>
                  <p className="text-xs text-navy/50">
                    {p.current_index != null ? `Index ${formatHcp(p.current_index)}` : "No index"} · <span className="uppercase">{p.role}</span>
                  </p>
                </div>
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
                    name="nickname"
                    defaultValue={p.nickname ?? ""}
                    placeholder="Nickname (shows on player card)"
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
                  <input
                    name="index"
                    type="text"
                    inputMode="decimal"
                    defaultValue={p.current_index != null ? formatHcp(p.current_index) : ""}
                    placeholder="USGA Index — use +2.0 for plus handicaps"
                    className="w-full rounded-lg border border-hairline px-3 py-1.5 text-sm text-navy"
                  />
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

                {/* Photo upload — separate from the form; saves immediately */}
                <label className="block w-full cursor-pointer rounded-lg border border-hairline px-3 py-1.5 text-center text-sm text-navy/70 hover:bg-parchment">
                  {uploadingId === p.id ? "Uploading…" : p.avatar_url ? "Replace photo" : "Upload photo"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploadingId === p.id}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadAvatar(p, f);
                      e.target.value = "";
                    }}
                  />
                </label>

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
