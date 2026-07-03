import { requirePlayer } from "@/lib/auth";
import { BottomNav } from "@/components/BottomNav";
import Image from "next/image";
import Link from "next/link";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const player = await requirePlayer();

  return (
    <div className="flex flex-col min-h-screen">
      <header className="bg-navy text-off-white px-4 py-2.5 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-8 h-8 rounded-full bg-off-white ring-1 ring-gold/60 overflow-hidden">
            <Image src="/crest-small.png" alt="Wooglin Cup crest" width={26} height={26} priority />
          </span>
          <span className="font-display font-bold tracking-wide text-lg">Wooglin Cup</span>
        </Link>
        <span className="text-xs text-hairline">
          {player.nickname ?? player.name} · {player.role}
        </span>
      </header>
      <main className="flex-1 pb-20">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
