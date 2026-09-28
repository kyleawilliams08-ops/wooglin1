"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCurrentEvent } from "@/lib/currentEvent";
import { failTo } from "@/lib/actionError";

const LIST = "/expenses";

/** Player ids on the trip, optionally just one team (matched by name). */
async function fieldPlayerIds(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  teamName?: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("event_participants")
    .select("player_id, teams(name)")
    .eq("event_id", eventId);
  const rows = (data ?? []) as unknown as { player_id: string | null; teams: { name: string } | null }[];
  return rows
    .filter((r) => r.player_id && (!teamName || r.teams?.name.trim().toLowerCase() === teamName.toLowerCase()))
    .map((r) => r.player_id as string);
}

export async function createExpense(formData: FormData): Promise<void> {
  const me = await requirePlayer();
  const supabase = createClient();
  const event = await getCurrentEvent(supabase);
  if (!event) { failTo(LIST, { message: "No active event." }); return; }

  const { data: ev } = await supabase.from("events").select("books_closed_at").eq("id", event.id).single();
  if (ev?.books_closed_at) { failTo(LIST, { message: "The books are closed for this year — ask the commissioner to reopen them." }); return; }
  const paidBy = (formData.get("paid_by") as string) || me.id;
  const amount = Math.round(parseFloat(formData.get("amount") as string) * 100) / 100;
  const description = ((formData.get("description") as string) || "").trim();
  const kind = formData.get("split_kind") as string;
  const back = "/expenses/new";
  if (!(amount > 0)) { failTo(back, { message: "Amount must be more than $0." }); return; }
  if (!description) { failTo(back, { message: "Give it a description." }); return; }
  if (!["all", "usa", "europe", "custom"].includes(kind)) { failTo(back, { message: "Pick who it's split between." }); return; }

  // Snapshot the split as explicit people so later roster edits can't move money.
  const everyone = await fieldPlayerIds(supabase, event.id);
  let shares: string[];
  if (kind === "all") shares = everyone;
  else if (kind === "custom") {
    const allowed = new Set(everyone);
    shares = Array.from(new Set(formData.getAll("share_ids") as string[])).filter((id) => allowed.has(id));
  } else shares = await fieldPlayerIds(supabase, event.id, kind === "usa" ? "USA" : "Europe");
  if (shares.length === 0) { failTo(back, { message: "Nobody to split it between." }); return; }

  const { data: row, error } = await supabase.from("expenses").insert({
    event_id: event.id, paid_by: paidBy, description, amount, split_kind: kind, created_by: me.id,
  }).select("id").single();
  if (error || !row) {
    failTo(back, error ?? { message: "Couldn't save — has the EXPENSES section of migrations.sql been run?" });
    return;
  }
  const { error: shareErr } = await supabase.from("expense_shares")
    .insert(shares.map((pid) => ({ expense_id: row.id, player_id: pid })));
  if (shareErr) {
    await supabase.from("expenses").delete().eq("id", row.id); // no half-saved expenses
    failTo(back, shareErr);
    return;
  }
  revalidatePath(LIST);
  redirect(`${LIST}?saved=1`);
}

/** Payer, whoever logged it, or an admin can delete. */
export async function deleteExpense(formData: FormData): Promise<void> {
  const me = await requirePlayer();
  const supabase = createClient();
  const id = formData.get("expense_id") as string;
  const { data: e } = await supabase.from("expenses").select("id, paid_by, created_by").eq("id", id).maybeSingle();
  if (!e) { failTo(LIST, { message: "Expense not found." }); return; }
  if (!isAdmin(me) && e.paid_by !== me.id && e.created_by !== me.id) {
    failTo(LIST, { message: "Only the person who paid (or logged it) can delete this." });
    return;
  }
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  failTo(LIST, error);
  revalidatePath(LIST);
  redirect(`${LIST}?saved=1`);
}

// ── Settle up (admin) ──────────────────────────────────────────────────────

/** Toggle a person's Paid mark for the current event. */
export async function togglePaid(formData: FormData): Promise<void> {
  const me = await requirePlayer();
  if (!isAdmin(me)) { failTo(LIST, { message: "Admins only." }); return; }
  const supabase = createClient();
  const event = await getCurrentEvent(supabase);
  if (!event) { failTo(LIST, { message: "No active event." }); return; }
  const playerId = formData.get("player_id") as string;
  const paid = formData.get("paid") === "1";
  const { error } = paid
    ? await supabase.from("event_settlements").upsert({ event_id: event.id, player_id: playerId, marked_by: me.id })
    : await supabase.from("event_settlements").delete().eq("event_id", event.id).eq("player_id", playerId);
  failTo(LIST, error);
  revalidatePath(LIST);
  redirect(`${LIST}?saved=1`);
}

/** Close (or reopen) the books: stamps the event; closed = no new expenses. */
export async function setBooksClosed(formData: FormData): Promise<void> {
  const me = await requirePlayer();
  if (!isAdmin(me)) { failTo(LIST, { message: "Admins only." }); return; }
  const supabase = createClient();
  const event = await getCurrentEvent(supabase);
  if (!event) { failTo(LIST, { message: "No active event." }); return; }
  const close = formData.get("close") === "1";
  const { error } = await supabase.from("events")
    .update({ books_closed_at: close ? new Date().toISOString() : null }).eq("id", event.id);
  failTo(LIST, error);
  revalidatePath(LIST);
  redirect(`${LIST}?saved=1`);
}
