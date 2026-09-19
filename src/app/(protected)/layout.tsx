import { requirePlayer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/BottomNav";
import { AlertOverlay } from "@/components/AlertOverlay";
import { SavedToast } from "@/components/SavedToast";
import { AvatarUploader } from "@/components/AvatarUploader";
import { TestLabBanner } from "@/components/TestLabBanner";
import { getTestModeEvent } from "@/lib/currentEvent";
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

  // Test Lab state (admins only; both null for everyone else)
  const testEvent = await getTestModeEvent(supabase);

  return (
    <div className="flex flex-col min-h-screen">
      <TestLabBanner
        viewingAs={player.masqueradedBy ? player.nickname ?? player.name : null}
        testEventName={testEvent?.name ?? null}
      />
      <header className="bg-navy text-off-white px-4 py-2.5 flex items-center justify-between print:hidden">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-8 h-8 rounded-full bg-off-white ring-1 ring-gold/60 overflow-hidden">
            <Image src="/crest-small.png" alt="Wooglin Cup crest" width={26} height={26} priority />
          </span>
          <span className="font-display font-bold tracking-wide text-lg">Wooglin Cup</span>
        </Link>
        <span className="flex items-center gap-2 text-xs text-hairline">
          {player.nickname ?? player.name} · {player.role}
          {player.masqueradedBy ? (
            // set_my_avatar is scoped to auth.uid() — it would change the admin's
            // own photo, not this player's — so no uploader while viewing as.
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-off-white/20 text-[10px] font-bold">
              {(player.nickname ?? player.name).slice(0, 2).toUpperCase()}
            </span>
          ) : (
            <AvatarUploader avatarUrl={player.avatar_url} name={player.nickname ?? player.name} />
          )}
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
