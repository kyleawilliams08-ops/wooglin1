"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * The header avatar, tap-to-change. Uploads to the avatars bucket and sets
 * the caller's own avatar_url via the set_my_avatar RPC (which is scoped to
 * auth.uid() server-side). Any player can change their own photo this way.
 */
export function AvatarUploader({
  avatarUrl,
  name,
}: {
  avatarUrl: string | null;
  name: string;
}) {
  const [uploading, setUploading] = useState(false);
  const router = useRouter();

  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  async function upload(file: File) {
    setUploading(true);
    const supabase = createClient();
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${Date.now()}.${ext}`; // timestamped so the CDN doesn't cache a stale one
    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, file, { cacheControl: "3600" });
    if (upErr) {
      alert(`Upload failed: ${upErr.message}`);
      setUploading(false);
      return;
    }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    const { error: rpcErr } = await supabase.rpc("set_my_avatar", { new_url: data.publicUrl });
    if (rpcErr) alert(`Couldn't save photo: ${rpcErr.message}`);
    else router.refresh();
    setUploading(false);
  }

  return (
    <label className="group relative cursor-pointer" title="Change your photo" aria-label="Change your photo">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover ring-1 ring-gold/60" />
      ) : (
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-off-white/15 text-[10px] font-bold text-off-white ring-1 ring-gold/60">
          {initials}
        </span>
      )}
      <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-[9px] text-white opacity-0 transition group-hover:opacity-100">
        {uploading ? "…" : "📷"}
      </span>
      <input
        type="file"
        accept="image/*"
        className="hidden"
        disabled={uploading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}
