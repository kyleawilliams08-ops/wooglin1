"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startLineupDraft } from "@/lib/lineupDraftActions";

/**
 * Admin control on /matches: choose who picks first and kick off the round's
 * lineup draft, dropping straight into the room. Clears the round's pairings —
 * confirms first since that's destructive if any were set.
 */
export function StartLineupDraftButton({
  roundId,
  homeTeam,
  awayTeam,
}: {
  roundId: string;
  homeTeam: { id: string; name: string; color: string };
  awayTeam: { id: string; name: string; color: string };
}) {
  const router = useRouter();
  const [first, setFirst] = useState(homeTeam.id);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const start = () => {
    if (!window.confirm("Start the lineup draft? Any pairings already set for this round will be cleared.")) return;
    setError(null);
    startTransition(async () => {
      const { error } = await startLineupDraft(roundId, first);
      if (error) setError(error);
      else router.push(`/matches/lineup-draft/${roundId}`);
    });
  };

  return (
    <div className="rounded-xl border border-dashed border-gold/60 bg-parchment px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-navy/50">First pick:</span>
        {[homeTeam, awayTeam].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFirst(t.id)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-bold text-white ${first === t.id ? "" : "opacity-35"}`}
            style={{ backgroundColor: t.color }}
          >
            {t.name}
          </button>
        ))}
      </div>
      <button
        onClick={start}
        disabled={isPending}
        className="w-full rounded-lg bg-europe-green py-2 text-sm font-bold text-white disabled:opacity-50"
      >
        {isPending ? "Starting…" : "🐉 Draft lineups"}
      </button>
      {error && <p className="text-xs text-usa-red">{error}</p>}
    </div>
  );
}
