import { requirePlayer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/BottomNav";
import { AlertOverlay } from "@/components/AlertOverlay";
import { SavedToast } from "@/components/SavedToast";
import { AvatarUploader } from "@/components/AvatarUploader";
import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const player = await requirePlayer();

  // Admin alerts this player hasn't acknowledged — the overlay takes over
  // every page until each one is dismissed.
  const supabase = createClient();
  const { data: alerts } = await supabase
    .from("admin_alerts")
    .select("id, title, message, created_at, alert_dismissals(player_id)")
    .order("created_at", { ascending: true });
  const pendingAlerts = (alerts ?? [])
    .filter((a) => !a.alert_dismissals?.some((d: { player_id: string }) => d.player_id === player.id))
    .map((a) => ({ id: a.id, title: a.title, message: a.message, created_at: a.created_at }));

  return (
    <div className="flex flex-col min-h-screen">
      <header className="bg-navy text-off-white px-4 py-2.5 flex items-center justify-between print:hidden">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-8 h-8 rounded-full bg-off-white ring-1 ring-gold/60 overflow-hidden">
            <Image src="/crest-small.png" alt="Wooglin Cup crest" width={26} height={26} priority />
          </span>
          <span className="font-display font-bold tracking-wide text-lg">Wooglin Cup</span>
        </Link>
        <span className="flex items-center gap-2 text-xs text-hairline">
          {player.nickname ?? player.name} · {player.role}
          <AvatarUploader avatarUrl={player.avatar_url} name={player.nickname ?? player.name} />
        </span>
      </header>
      <main className="flex-1 pb-20">
        {children}
      </main>
      <BottomNav />
      <AlertOverlay alerts={pendingAlerts} />
      <Suspense fallback={null}>
        <SavedToast />
      </Suspense>
    </div>
  );
}
