import { requirePlayer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { BetWizard, type WizardPlayer } from "@/components/BetWizard";
import { ErrorBanner } from "@/components/ErrorBanner";
import { failTo } from "@/lib/actionError";
import { recordBetProposed } from "@/lib/feed";

async function getActor(supabase: ReturnType<typeof createClient>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase
    .from("players").select("id, role").eq("auth_user_id", user.id).single();
  if (!me) redirect("/login");
  return { id: me.id as string };
}

// One-tap-per-page bet proposal wizard.
export default async function NewBetPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const player = await requirePlayer();
  const supabase = createClient();

  const { data: allPlayers } = await supabase
    .from("players").select("id, name, nickname, avatar_url").order("name");

  // Limit to the active cup's roster; fall back to everyone off-season.
  const { data: activeEvents } = await supabase
    .from("events").select("id").eq("status", "active")
    .order("year", { ascending: false }).limit(1);
  let rosterIds: Set<string> | null = null;
  if (activeEvents?.[0]) {
    const { data: eps } = await supabase
      .from("event_participants")
      .select("player_id")
      .eq("event_id", activeEvents[0].id)
      .not("player_id", "is", null);
    const ids = (eps ?? []).map((e) => e.player_id as string);
    if (ids.length > 0) rosterIds = new Set(ids);
  }

  const options: WizardPlayer[] = (allPlayers ?? [])
    .filter((p) => p.id !== player.id && (!rosterIds || rosterIds.has(p.id)))
    .map((p) => ({
      id: p.id as string,
      label: (p.nickname ?? p.name) as string,
      avatarUrl: p.avatar_url as string | null,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  async function createBet(formData: FormData) {
    "use server";
    const supabase = createClient();
    const me = await getActor(supabase);
    const type = formData.get("bet_type") as string;
    const amount = parseFloat(formData.get("amount") as string);
    const description = (formData.get("description") as string)?.trim() || null;
    if (!["h2h", "teams", "group"].includes(type)) failTo("/bets/new", { message: "Unknown bet type" });
    if (!(amount > 0)) failTo("/bets/new", { message: "Amount must be positive" });

    const parts: { player_id: string; side: number | null }[] = [];
    if (type === "h2h") {
      const opp = formData.get("opponent") as string;
      if (!opp || opp === me.id) failTo("/bets/new", { message: "Pick an opponent" });
      parts.push({ player_id: me.id, side: 1 }, { player_id: opp, side: 2 });
    } else if (type === "teams") {
      const partner = formData.get("partner") as string;
      const opp1 = formData.get("opp1") as string;
      const opp2 = formData.get("opp2") as string;
      const ids = [me.id, partner, opp1, opp2];
      if (ids.some((x) => !x) || new Set(ids).size !== 4) {
        failTo("/bets/new", { message: "A 2v2 needs four different players" });
      }
      parts.push(
        { player_id: me.id, side: 1 }, { player_id: partner, side: 1 },
        { player_id: opp1, side: 2 }, { player_id: opp2, side: 2 },
      );
    } else {
      const ids = (formData.getAll("group_ids") as string[]).filter((x) => x && x !== me.id);
      if (new Set(ids).size < 2) failTo("/bets/new", { message: "A group bet needs at least 2 others" });
      parts.push({ player_id: me.id, side: null });
      for (const pid of Array.from(new Set(ids))) parts.push({ player_id: pid, side: null });
    }

    const { data: betRow, error } = await supabase
      .from("bets")
      .insert({ year: new Date().getFullYear(), bet_type: type, amount, description, status: "active", created_by: me.id })
      .select("id")
      .single();
    failTo("/bets/new", error);
    const { error: pErr } = await supabase
      .from("bet_participants")
      .insert(parts.map((p) => ({ ...p, bet_id: betRow!.id })));
    failTo("/bets/new", pErr);
    await recordBetProposed(supabase, betRow!.id); // best-effort feed post
    revalidatePath("/bets");
    revalidatePath("/");
    redirect("/bets");
  }

  return (
    <>
      {searchParams.error && (
        <div className="px-4 pt-4">
          <ErrorBanner message={searchParams.error} />
        </div>
      )}
      <BetWizard players={options} action={createBet} />
    </>
  );
}
