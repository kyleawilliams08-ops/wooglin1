"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { claimCtp } from "@/lib/ctpActions";

const HOLD_MS = 1200;

/**
 * Hold-to-claim CTP button. A stray tap mid-scroll can't fire it: the press
 * must be held for HOLD_MS (gold fill shows progress), and releasing early,
 * scrolling away, or a pointer cancel resets it. Deliberately harder to
 * "accidentally touch" than a confirm dialog people reflexively OK.
 */
export function CtpClaimButton({
  ctpId,
  day,
  holeNumber,
}: {
  ctpId: string;
  day: string;
  holeNumber: number;
}) {
  const [progress, setProgress] = useState(0); // 0..1
  const [isPending, startTransition] = useTransition();
  const raf = useRef<number | null>(null);
  const start = useRef<number | null>(null);
  const fired = useRef(false);

  const reset = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    start.current = null;
    setProgress(0);
  };

  const fire = () => {
    if (fired.current) return;
    fired.current = true;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("ctp_id", ctpId);
      fd.set("day", day);
      await claimCtp(fd);
      fired.current = false;
    });
    reset();
  };

  const tick = (now: number) => {
    if (start.current === null) return;
    const p = Math.min((now - start.current) / HOLD_MS, 1);
    setProgress(p);
    if (p >= 1) fire();
    else raf.current = requestAnimationFrame(tick);
  };

  const press = () => {
    if (isPending || fired.current) return;
    start.current = performance.now();
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => reset(), []);

  const holding = progress > 0 && !isPending;

  return (
    <button
      type="button"
      onPointerDown={press}
      onPointerUp={reset}
      onPointerLeave={reset}
      onPointerCancel={reset}
      onContextMenu={(e) => e.preventDefault()}
      disabled={isPending}
      aria-label={`Hold to claim closest to the pin on hole ${holeNumber}`}
      className="relative shrink-0 touch-none select-none overflow-hidden rounded-full bg-navy px-3 py-1.5 text-xs font-bold text-off-white disabled:opacity-60"
    >
      {/* gold progress bar along the bottom while holding */}
      <span
        className="absolute bottom-0 left-0 h-1 bg-gold"
        style={{ width: `${progress * 100}%`, transition: progress === 0 ? "width 150ms ease-out" : "none" }}
      />
      <span className="relative">
        {isPending ? "Claiming…" : holding ? "Keep holding…" : "Hold if closest 🎯"}
      </span>
    </button>
  );
}
