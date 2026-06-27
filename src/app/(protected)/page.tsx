import { requirePlayer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function Home() {
  const player = await requirePlayer();
  const supabase = createClient();

  const { data: activeEvent } = await supabase
    .from("events")
    .select("*")
    .eq("status", "active")
    .single();

  async function signOut() {
    "use server";
    const supabase = createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  return (
    <div className="px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-navy">
          Welcome, {player.nickname ?? player.name}
        </h1>
        <p className="text-sm text-navy/50 uppercase tracking-widest mt-0.5">
          {player.role}
        </p>
      </div>

      <div className="rounded-xl bg-navy text-off-white p-5">
        {activeEvent ? (
          <>
            <p className="text-xs text-hairline/60 uppercase tracking-widest mb-1">Active Event</p>
            <p className="text-lg font-display font-semibold">{activeEvent.name}</p>
            <p className="text-sm text-hairline mt-1">{activeEvent.location}</p>
          </>
        ) : (
          <p className="text-sm text-hairline">No active event. Check back soon.</p>
        )}
      </div>

      <form action={signOut}>
        <button
          type="submit"
          className="text-sm text-navy/40 hover:text-navy transition-colors"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
