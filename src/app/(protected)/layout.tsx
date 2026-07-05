import { requirePlayer } from "@/lib/auth";
import { BottomNav } from "@/components/BottomNav";
import Image from "next/image";
import Link from "next/link";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const player = await requirePlayer();

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
          {player.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={player.avatar_url} alt=""
              className="h-7 w-7 rounded-full object-cover ring-1 ring-gold/60" />
          ) : (
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-off-white/15 text-[10px] font-bold text-off-white ring-1 ring-gold/60">
              {(player.nickname ?? player.name).split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
            </span>
          )}
        </span>
      </header>
      <main className="flex-1 pb-20">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
