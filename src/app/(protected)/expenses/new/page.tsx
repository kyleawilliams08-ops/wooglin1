import { requirePlayer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCurrentEvent } from "@/lib/currentEvent";
import { redirect } from "next/navigation";
import { ErrorBanner } from "@/components/ErrorBanner";
import { ExpenseWizard } from "@/components/ExpenseWizard";
import { createExpense } from "@/lib/expenseActions";
import type { WizardPlayer } from "@/components/BetWizard";

export const dynamic = "force-dynamic";

export default async function NewExpensePage({ searchParams }: { searchParams: { error?: string } }) {
  const me = await requirePlayer();
  const supabase = createClient();
  const event = await getCurrentEvent(supabase);
  if (!event) redirect("/expenses");

  const { data: partsRaw } = await supabase
    .from("event_participants")
    .select("player_id, display_name, players(name, nickname, avatar_url), teams(name)")
    .eq("event_id", event.id);
  const parts = (partsRaw ?? []) as unknown as {
    player_id: string | null; display_name: string;
    players: { name: string; nickname: string | null; avatar_url: string | null } | null;
    teams: { name: string } | null;
  }[];
  const players: WizardPlayer[] = parts
    .filter((p) => p.player_id)
    .map((p) => ({ id: p.player_id as string, label: p.players?.nickname ?? p.players?.name ?? p.display_name, avatarUrl: p.players?.avatar_url ?? null }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const teamNames = {
    usa: parts.find((p) => p.teams?.name.trim().toLowerCase() === "usa")?.teams?.name.trim() ?? null,
    europe: parts.find((p) => p.teams?.name.trim().toLowerCase() === "europe")?.teams?.name.trim() ?? null,
  };

  return (
    <>
      {searchParams.error && <div className="px-4 pt-4"><ErrorBanner message={searchParams.error} /></div>}
      <ExpenseWizard players={players} me={me.id} teamNames={teamNames} action={createExpense} />
    </>
  );
}
