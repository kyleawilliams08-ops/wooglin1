"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Shows a failed action's message from ?error=. Dismissible — the param
 * otherwise survives reloads, so a fixed problem keeps showing its old
 * banner. The ✕ strips ?error= from the URL.
 */
export function ErrorBanner({ message }: { message?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  if (!message) return null;

  const dismiss = () => {
    const next = new URLSearchParams(sp.toString());
    next.delete("error");
    router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
  };

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg bg-usa-red/10 px-3 py-2">
      <p className="text-sm text-usa-red">{message}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss error"
        className="shrink-0 text-sm text-usa-red/60 hover:text-usa-red"
      >
        ✕
      </button>
    </div>
  );
}
