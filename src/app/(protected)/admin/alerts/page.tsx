import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { DeleteButton } from "@/components/DeleteButton";

export default async function AdminAlertsPage({
  searchParams,
}: {
  searchParams: { error?: string; edit?: string };
}) {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const supabase = createClient();
  const [{ data: alerts }, { count: playerCount }] = await Promise.all([
    supabase
      .from("admin_alerts")
      .select("*, alert_dismissals(player_id)")
      .order("created_at", { ascending: false }),
    supabase.from("players").select("*", { count: "exact", head: true }),
  ]);

  // ?edit=<id> prefills the form with that alert
  const editing = searchParams.edit
    ? alerts?.find((a) => a.id === searchParams.edit) ?? null
    : null;

  async function saveAlert(formData: FormData) {
    "use server";
    const me = await requirePlayer();
    if (!isAdmin(me)) redirect("/");
    const supabase = createClient();
    const id = formData.get("id") as string;
    const fields = {
      title: (formData.get("title") as string) || null,
      message: formData.get("message") as string,
    };
    const { error } = id
      ? await supabase
          .from("admin_alerts")
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq("id", id)
      : await supabase.from("admin_alerts").insert({ ...fields, created_by: me.id });
    if (error) redirect(`/admin/alerts?error=${encodeURIComponent(error.message)}`);
    revalidatePath("/", "layout");
    redirect("/admin/alerts");
  }

  async function deleteAlert(formData: FormData) {
    "use server";
    const me = await requirePlayer();
    if (!isAdmin(me)) redirect("/");
    const supabase = createClient();
    const { error } = await supabase
      .from("admin_alerts")
      .delete()
      .eq("id", formData.get("id") as string);
    if (error) redirect(`/admin/alerts?error=${encodeURIComponent(error.message)}`);
    revalidatePath("/", "layout");
  }

  const inputCls = "w-full rounded-lg border border-hairline px-3 py-2 text-sm text-navy";

  return (
    <div className="px-4 py-6 space-y-6">
      <Link href="/menu" className="text-sm text-navy/50 hover:text-navy">← Menu</Link>
      <h1 className="text-2xl font-display font-bold text-navy">Admin Alerts</h1>
      <p className="text-sm text-navy/50 -mt-4">
        Alerts take over everyone&rsquo;s screen until they tap OK. Each player
        sees an alert once; editing updates it for anyone who hasn&rsquo;t
        dismissed it yet.
      </p>

      <form
        action={saveAlert}
        key={editing?.id ?? "new"}
        className="rounded-xl border border-hairline bg-parchment p-4 space-y-3"
      >
        <div className="flex items-center justify-between">
          <p className="font-semibold text-navy text-sm">
            {editing ? "Editing alert" : "New alert"}
          </p>
          {editing && (
            <Link href="/admin/alerts" className="text-xs text-navy/50 underline">Cancel</Link>
          )}
        </div>
        {searchParams.error && (
          <p className="rounded-lg bg-usa-red/10 px-3 py-2 text-sm text-usa-red">
            {searchParams.error}
          </p>
        )}
        <input type="hidden" name="id" value={editing?.id ?? ""} />
        <input
          name="title"
          placeholder="Title (optional, e.g. Tee times moved up!)"
          defaultValue={editing?.title ?? ""}
          className={inputCls}
        />
        <textarea
          name="message"
          required
          rows={3}
          placeholder="Message — everyone will see this full-screen"
          defaultValue={editing?.message ?? ""}
          className={inputCls}
        />
        <button
          type="submit"
          className="w-full rounded-lg bg-navy py-2 text-sm font-semibold text-off-white"
        >
          {editing ? "Save Alert" : "Send Alert"}
        </button>
      </form>

      <ul className="space-y-2">
        {alerts?.map((a) => (
          <li key={a.id} className="rounded-xl border border-hairline bg-white px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {a.title && <p className="font-semibold text-navy">{a.title}</p>}
                <p className="text-sm text-navy/70 whitespace-pre-wrap">{a.message}</p>
                <p className="mt-1 text-xs text-navy/40">
                  {new Date(a.created_at).toLocaleDateString("en-US", {
                    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                  })}
                  {" · "}Seen by {a.alert_dismissals?.length ?? 0} of {playerCount ?? "—"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                <Link
                  href={`/admin/alerts?edit=${a.id}`}
                  className="text-sm text-navy/60 hover:text-navy underline underline-offset-2"
                >
                  Edit
                </Link>
                <DeleteButton
                  action={deleteAlert}
                  fields={{ id: a.id }}
                  confirm="Delete this alert? It disappears for anyone who hasn't dismissed it yet."
                />
              </div>
            </div>
          </li>
        ))}
        {!alerts?.length && (
          <li className="rounded-xl border border-dashed border-hairline px-4 py-6 text-center text-sm text-navy/40">
            No alerts yet.
          </li>
        )}
      </ul>
    </div>
  );
}
