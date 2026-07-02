"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "wooglin-install-dismissed";

/**
 * "Add to Home Screen" banner. Android/Chrome: captures beforeinstallprompt
 * and triggers the native install dialog. iOS Safari: shows the manual
 * Share → Add to Home Screen hint. Hidden once installed or dismissed.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) return; // already installed
    if (localStorage.getItem(DISMISS_KEY)) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iOS Safari never fires beforeinstallprompt — show the manual hint.
    const ua = window.navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /safari/i.test(ua) && !/crios|fxios|chrome/i.test(ua);
    if (isIos && isSafari) {
      setShowIosHint(true);
      setVisible(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") setVisible(false);
  };

  return (
    <div className="rounded-xl border border-gold/50 bg-parchment px-4 py-3 flex items-center justify-between gap-3">
      <div className="text-sm text-navy">
        <p className="font-semibold">Put the Clubhouse on your home screen</p>
        {showIosHint ? (
          <p className="text-navy/60 text-xs mt-0.5">
            Tap <span className="font-semibold">Share</span> → <span className="font-semibold">Add to Home Screen</span>
          </p>
        ) : (
          <p className="text-navy/60 text-xs mt-0.5">One tap, full screen, no browser bar.</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {deferred && (
          <button onClick={install}
            className="rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-off-white">
            Install
          </button>
        )}
        <button onClick={dismiss} className="text-navy/40 text-lg leading-none px-1" aria-label="Dismiss">
          ×
        </button>
      </div>
    </div>
  );
}
