import { requirePlayer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function Home() {
  const player = await requirePlayer();

  async function signOut() {
    "use server";
    const supabase = createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-navy text-off-white px-6">
      <h1 className="text-3xl font-display font-bold tracking-wide">
        Wooglin Cup Clubhouse
      </h1>
      <p className="mt-2 text-hairline text-sm">
        Welcome, {player.nickname ?? player.name}
      </p>
      <p className="mt-1 text-hairline/60 text-xs uppercase tracking-widest">
        {player.role}
      </p>
      <form action={signOut} className="mt-8">
        <button
          type="submit"
          className="rounded-lg border border-hairline/30 px-4 py-2 text-sm text-hairline hover:bg-white/10 transition-colors"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
