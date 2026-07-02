"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribes to Supabase Realtime changes on hole_scores and matchups and
 * refreshes the server-rendered page when anything changes. Pass matchupId
 * to narrow the hole_scores subscription to one match.
 *
 * Requires the tables to be in the realtime publication:
 *   alter publication supabase_realtime add table hole_scores;
 *   alter publication supabase_realtime add table matchups;
 */
export function LiveRefresher({ matchupId }: { matchupId?: string }) {
  const router = useRouter();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const refresh = () => {
      // Batch bursts of events (e.g. a 9-hole save = 9 upserts) into one refresh.
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => router.refresh(), 400);
    };

    const channel = supabase
      .channel(`live-${matchupId ?? "board"}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "hole_scores",
          ...(matchupId ? { filter: `matchup_id=eq.${matchupId}` } : {}),
        },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matchups" },
        refresh,
      )
      .subscribe();

    return () => {
      if (debounce.current) clearTimeout(debounce.current);
      supabase.removeChannel(channel);
    };
  }, [router, matchupId]);

  return null;
}
