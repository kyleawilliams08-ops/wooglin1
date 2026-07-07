import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { DeleteButton } from "@/components/DeleteButton";
import { recordDraftEvent } from "@/lib/feed";

/**
 * Draft setup: create the draft for an event, set draft day / first pick /
 * pick clock / call link, start it, and (if the dry run goes sideways)
 * reset or delete it. The draft itself runs in /draft.
 */
export default async function AdminDraftPage({
  searchParams,
}: {
  searchParams: { error?: string; edit?: string };
}) {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const supabase = createClient();
  const [{ data: events }, { data: drafts }] = await Promise.all([
    supabase.from("events").select("id, name, year, status").order("year", { ascending: false }),
    supabase.from("drafts").select("*, events(name, year)").order("created_at", { ascending: false }),
  ]);

  const draftEventIds = (drafts ?? []).map((d) => d.event_id);
  const [{ data: teams }, { data: participants }] = await Promise.all([
    draftEventIds.length
      ? supabase.from("teams").select("id, event_id, name, color").in("event_id", draftEventIds).order("name")
      : Promise.resolve({ data: [] as { id: string; event_id: string; name: string; color: string }[] }),
    draftEventIds.length
      ? supabase.from("event_participants").select("id, event_id, team_id, is_captain").in("event_id", draftEventIds)
      : Promise.resolve({ data: [] as { id: string; event_id: string; team_id: string | null; is_captain: boolean }[] }),
  ]);

  const editing = searchParams.edit
    ? drafts?.find((d) => d.id === searchParams.edit) ?? null
    : null;

  // Events without a draft yet, for the create form
  const eventsWithout = (events ?? []).filter((e) => !draftEventIds.includes(e.id));

  async function requireAdmin() {
    "use server";
    const me = await requirePlayer();
    if (!isAdmin(me)) redirect("/");
  }

  async function saveDraft(formData: FormData) {
    "use server";
    await requireAdmin();
    const supabase = createClient();
    const id = formData.get("id") as string;
    const scheduledLocal = formData.get("scheduled_at") as string;
    const fields = {
      scheduled_at: scheduledLocal ? new Date(scheduledLocal).toISOString() : null,
      pick_seconds: parseInt(formData.get("pick_seconds") as string) || 120,
      call_link: (formData.get("call_link") as string) || null,
    };
    const { error } = id
      ? await supabase.from("drafts").update(fields).eq("id", id)
      : await supabase.from("drafts").insert({ ...fields, event_id: formData.get("event_id") as string });
    if (error) redirect(`/admin/draft?error=${encodeURIComponent(error.message)}`);
    revalidatePath("/admin/draft");
    revalidatePath("/draft");
    revalidatePath("/");
    redirect("/admin/draft");
  }

  async function setFirstPick(formData: FormData) {
    "use server";
    await requireAdmin();
    const supabase = createClient();
    const { error } = await supabase.from("drafts")
      .update({ first_pick_team_id: formData.get("team_id") as string })
      .eq("id", formData.get("id") as string);
    if (error) redirect(`/admin/draft?error=${encodeURIComponent(error.message)}`);
    revalidatePath("/admin/draft");
    revalidatePath("/draft");
  }

  async function startDraft(formData: FormData) {
    "use server";
    await requireAdmin();
    const supabase = createClient();
    const id = formData.get("id") as string;
    const { data: draft } = await supabase
      .from("drafts").select("event_id, events(year)").eq("id", id).single();
    const { error } = await supabase.from("drafts").update({
      status: "live",
      current_pick_started_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) redirect(`/admin/draft?error=${encodeURIComponent(error.message)}`);
    if (draft) {
      const year = (draft.events as unknown as { year: number } | null)?.year;
      await recordDraftEvent(supabase, draft.event_id,
        `🐉 The${year ? ` ${year}` : ""} draft is LIVE — watch the picks!`);
    }
    revalidatePath("/admin/draft");
    revalidatePath("/draft");
    revalidatePath("/");
    redirect("/draft");
  }

  async function resetDraft(formData: FormData) {
    "use server";
    await requireAdmin();
    const supabase = createClient();
    const id = formData.get("id") as string;
    const { data: draft } = await supabase.from("drafts").select("event_id").eq("id", id).single();
    if (!draft) redirect("/admin/draft");
    // Clear drafted team assignments (captains keep theirs), then the picks.
    const { data: picks, error: picksError } = await supabase
      .from("draft_picks").select("participant_id").eq("draft_id", id);
    if (picksError) redirect(`/admin/draft?error=${encodeURIComponent(picksError.message)}`);
    const ids = (picks ?? []).map((p) => p.participant_id);
    if (ids.length) {
      const { error } = await supabase.from("event_participants")
        .update({ team_id: null }).in("id", ids);
      if (error) redirect(`/admin/draft?error=${encodeURIComponent(error.message)}`);
    }
    const { error: delError } = await supabase.from("draft_picks").delete().eq("draft_id", id);
    if (delError) redirect(`/admin/draft?error=${encodeURIComponent(delError.message)}`);
    const { error: stError } = await supabase.from("drafts")
      .update({ status: "scheduled", current_pick_started_at: null }).eq("id", id);
    if (stError) redirect(`/admin/draft?error=${encodeURIComponent(stError.message)}`);
    revalidatePath("/admin/draft");
    revalidatePath("/draft");
    revalidatePath("/");
  }

  async function deleteDraft(formData: FormData) {
    "use server";
    await requireAdmin();
    const supabase = createClient();
    const { error } = await supabase.from("drafts").delete().eq("id", formData.get("id") as string);
    if (error) redirect(`/admin/draft?error=${encodeURIComponent(error.message)}`);
    revalidatePath("/admin/draft");
    revalidatePath("/draft");
    revalidatePath("/");
  }

  const inputCls = "w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy";
  const toLocalInput = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <div className="px-4 py-6 space-y-6">
      <Link href="/menu" className="text-sm text-navy/50 hover:text-navy">← Menu</Link>
      <h1 className="text-2xl font-display font-bold text-navy">Draft Setup</h1>
      <p className="text-sm text-navy/50 -mt-4">
        The pool is the event&rsquo;s participants who have no team yet — captains
        must already be on their teams. Everything else happens in the{" "}
        <Link href="/draft" className="underline">Draft Room</Link>.
      </p>

      {searchParams.error && (
        <p className="rounded-lg bg-usa-red/10 px-3 py-2 text-sm text-usa-red">{searchParams.error}</p>
      )}

      {/* create / edit form */}
      <form
        action={saveDraft}
        key={editing?.id ?? "new"}
        className="rounded-xl border border-hairline bg-parchment p-4 space-y-3"
      >
        <div className="flex items-center justify-between">
          <p className="font-semibold text-navy text-sm">
            {editing
              ? `Editing the ${(editing.events as { year: number } | null)?.year ?? ""} draft`
              : "Schedule a draft"}
          </p>
          {editing && <Link href="/admin/draft" className="text-xs text-navy/50 underline">Cancel</Link>}
        </div>
        <input type="hidden" name="id" value={editing?.id ?? ""} />
        {!editing && (
          <select name="event_id" required defaultValue="" className={`${inputCls} bg-white`}>
            <option value="" disabled>Event…</option>
            {eventsWithout.map((e) => (
              <option key={e.id} value={e.id}>{e.year} — {e.name}</option>
            ))}
          </select>
        )}
        <label className="block text-xs text-navy/50">
          Draft day &amp; time
          <input name="scheduled_at" type="datetime-local"
            defaultValue={toLocalInput(editing?.scheduled_at ?? null)} className={`${inputCls} mt-1`} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-navy/50">
            Pick clock (seconds, soft)
            <input name="pick_seconds" type="number" min={15}
              defaultValue={editing?.pick_seconds ?? 120} className={`${inputCls} mt-1`} />
          </label>
          <label className="block text-xs text-navy/50">
            Call link (FaceTime/Zoom)
            <input name="call_link" type="url" placeholder="https://…"
              defaultValue={editing?.call_link ?? ""} className={`${inputCls} mt-1`} />
          </label>
        </div>
        <button type="submit" className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white">
          {editing ? "Save Draft Settings" : "Create Draft"}
        </button>
      </form>

      {/* existing drafts */}
      <ul className="space-y-3">
        {drafts?.map((d) => {
          const ev = d.events as unknown as { name: string; year: number } | null;
          const dTeams = (teams ?? []).filter((t) => t.event_id === d.event_id);
          const dParts = (participants ?? []).filter((p) => p.event_id === d.event_id);
          const captains = dParts.filter((p) => p.is_captain).length;
          const poolCount = dParts.filter((p) => !p.is_captain && !p.team_id).length;
          const firstTeam = dTeams.find((t) => t.id === d.first_pick_team_id) ?? dTeams[0];
          const ready = dTeams.length === 2 && captains >= 2 && poolCount > 0;
          return (
            <li key={d.id} className="rounded-xl border border-hairline bg-white p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-navy">
                    {ev?.year} — {ev?.name}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                      d.status === "live" ? "bg-gold text-navy"
                      : d.status === "complete" ? "bg-europe-green text-white"
                      : "bg-navy/10 text-navy/60"
                    }`}>
                      {d.status}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-navy/50">
                    {d.scheduled_at
                      ? new Date(d.scheduled_at).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                        })
                      : "No date set"}
                    {" · "}{poolCount} in pool · clock {d.pick_seconds}s
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Link href={`/admin/draft?edit=${d.id}`}
                    className="text-sm text-navy/60 underline underline-offset-2 hover:text-navy">
                    Edit
                  </Link>
                  <DeleteButton
                    action={deleteDraft}
                    fields={{ id: d.id }}
                    confirm="Delete this draft? Picks are erased but any team assignments already made stay on the rosters."
                  />
                </div>
              </div>

              {/* first pick selector */}
              {d.status === "scheduled" && dTeams.length === 2 && (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-navy/50">First pick:</p>
                  {dTeams.map((t) => (
                    <form key={t.id} action={setFirstPick}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="team_id" value={t.id} />
                      <button
                        type="submit"
                        className={`rounded-full px-3 py-1 text-xs font-bold text-white ${
                          firstTeam?.id === t.id ? "" : "opacity-35"
                        }`}
                        style={{ backgroundColor: t.color }}
                      >
                        {t.name}{firstTeam?.id === t.id ? " ✓" : ""}
                      </button>
                    </form>
                  ))}
                </div>
              )}

              {!ready && d.status === "scheduled" && (
                <p className="rounded-lg bg-gold/15 px-3 py-2 text-xs text-navy/70">
                  Before starting: the event needs 2 teams ({dTeams.length}),
                  captains on both ({captains}), and undrafted players in the pool ({poolCount}).
                  Manage those in <Link href="/admin/events" className="underline">Events</Link>.
                </p>
              )}

              <div className="flex items-center gap-3">
                {d.status === "scheduled" && ready && (
                  <form action={startDraft} className="flex-1">
                    <input type="hidden" name="id" value={d.id} />
                    <button type="submit"
                      className="w-full rounded-lg bg-europe-green py-2 text-sm font-bold text-white">
                      🐉 Start the Draft
                    </button>
                  </form>
                )}
                {d.status !== "scheduled" && (
                  <>
                    <Link href="/draft"
                      className="flex-1 rounded-lg bg-navy py-2 text-center text-sm font-semibold text-off-white">
                      Open Draft Room
                    </Link>
                    <DeleteButton
                      action={resetDraft}
                      fields={{ id: d.id }}
                      confirm="Reset the draft? All picks are erased and drafted players go back into the pool (captains keep their teams)."
                      label="Reset"
                      className="rounded-lg border border-usa-red/40 px-3 py-2 text-sm font-semibold text-usa-red"
                    />
                  </>
                )}
              </div>
            </li>
          );
        })}
        {!drafts?.length && (
          <li className="rounded-xl border border-dashed border-hairline px-4 py-6 text-center text-sm text-navy/40">
            No drafts yet.
          </li>
        )}
      </ul>
    </div>
  );
}
