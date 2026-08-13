"use client";

import { useEffect, useRef, useState } from "react";

// Minimal shape of the bits of the YouTube IFrame API we use.
interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  destroy: () => void;
  setVolume: (v: number) => void;
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
}
type YTWindow = Window & {
  YT?: YTNamespace;
  onYouTubeIframeAPIReady?: () => void;
};

let apiPromise: Promise<void> | null = null;

/** Load the IFrame API once, shared across players. */
function loadApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const w = window as YTWindow;
    if (w.YT?.Player) return resolve();
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return apiPromise;
}

/**
 * A looping YouTube player we can drive from React — the IFrame API (rather
 * than a bare <iframe>) is what lets the draft room pause it during a pick
 * reveal and resume it afterwards.
 */
export function YouTubePlayer({
  videoId,
  width,
  height,
  paused = false,
  className,
}: {
  videoId: string;
  width: number;
  height: number;
  /** true → pause; back to false → resume */
  paused?: boolean;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadApi().then(() => {
      const w = window as YTWindow;
      if (cancelled || !hostRef.current || !w.YT?.Player) return;
      playerRef.current = new w.YT.Player(hostRef.current, {
        videoId,
        width,
        height,
        playerVars: {
          autoplay: 1,
          loop: 1,
          playlist: videoId,   // loop=1 only repeats when paired with this
          modestbranding: 1,
          rel: 0,
        },
        events: { onReady: () => setReady(true) },
      });
    });
    return () => {
      cancelled = true;
      try { playerRef.current?.destroy(); } catch { /* already gone */ }
      playerRef.current = null;
    };
  }, [videoId, width, height]);

  // Only resume what we paused, so a manual pause isn't overridden.
  const weParused = useRef(false);
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !ready) return;
    try {
      if (paused) {
        p.pauseVideo();
        weParused.current = true;
      } else if (weParused.current) {
        p.playVideo();
        weParused.current = false;
      }
    } catch { /* player torn down mid-transition */ }
  }, [paused, ready]);

  // YT.Player REPLACES the element it's handed, so the host div can't carry
  // our styling — wrap it and style the wrapper instead.
  return (
    <div className={className} style={{ width, height }}>
      <div ref={hostRef} />
    </div>
  );
}
