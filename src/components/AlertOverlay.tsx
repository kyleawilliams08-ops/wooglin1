"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { dismissAlert } from "@/lib/alertActions";

export interface PendingAlert {
  id: string;
  title: string | null;
  message: string;
  created_at: string;
}

/**
 * Full-screen takeover for admin alerts the signed-in player hasn't
 * acknowledged yet. Shows one at a time (oldest first); OK and the ✕ both
 * record the dismissal. Mounted in the protected layout so it covers every
 * page.
 */
export function AlertOverlay({ alerts }: { alerts: PendingAlert[] }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Realtime: pop new/edited alerts into open sessions without a manual
  // refresh. Requires admin_alerts in the realtime publication.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("admin-alerts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "admin_alerts" },
        () => router.refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [router]);

  const pending = alerts.filter((a) => !dismissed.includes(a.id));
  const alert = pending[0];
  if (!alert) return null;

  const dismiss = () => {
    setError(null);
    startTransition(async () => {
      const { error } = await dismissAlert(alert.id);
      if (error) setError(error);
      else setDismissed((d) => [...d, alert.id]);
    });
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-navy/95 px-6 print:hidden">
      <div className="relative w-full max-w-sm rounded-2xl bg-parchment p-6 pt-10 shadow-2xl">
        <button
          onClick={dismiss}
          disabled={isPending}
          aria-label="Dismiss alert"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-lg text-navy/40 hover:bg-navy/10 hover:text-navy disabled:opacity-50"
        >
          ✕
        </button>
        <div className="flex flex-col items-center gap-3 text-center">
          <Image src="/crest-small.png" alt="" width={44} height={44} />
          <p className="text-xs font-semibold uppercase tracking-widest text-gold">
            Commissioner Alert
          </p>
          {alert.title && (
            <h2 className="font-display text-2xl font-bold text-navy">{alert.title}</h2>
          )}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-navy/80">
            {alert.message}
          </p>
          {error && (
            <p className="w-full rounded-lg bg-usa-red/10 px-3 py-2 text-sm text-usa-red">
              {error}
            </p>
          )}
          <button
            onClick={dismiss}
            disabled={isPending}
            className="mt-2 w-full rounded-lg bg-navy py-2.5 text-sm font-semibold text-off-white disabled:opacity-50"
          >
            {isPending ? "One sec…" : "OK"}
          </button>
          {pending.length > 1 && (
            <p className="text-xs text-navy/40">
              {pending.length - 1} more alert{pending.length > 2 ? "s" : ""} after this one
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
