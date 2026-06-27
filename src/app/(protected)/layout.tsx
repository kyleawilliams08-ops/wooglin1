import { requirePlayer, isAdmin } from "@/lib/auth";
import { BottomNav } from "@/components/BottomNav";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const player = await requirePlayer();

  return (
    <div className="flex flex-col min-h-screen">
      <header className="bg-navy text-off-white px-4 py-3 flex items-center justify-between">
        <span className="font-display font-bold tracking-wide">Wooglin Cup</span>
        <span className="text-xs text-hairline">
          {player.nickname ?? player.name} · {player.role}
        </span>
      </header>
      <main className="flex-1 pb-16">
        {children}
      </main>
      <BottomNav isAdmin={isAdmin(player)} />
    </div>
  );
}
