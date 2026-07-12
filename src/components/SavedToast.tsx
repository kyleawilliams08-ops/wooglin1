"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Global "Saved ✓" confirmation. Any server action that finishes with
 * redirect(`${path}?saved=1`) triggers a brief toast. Mounted once in the
 * protected layout; it strips the ?saved param so a refresh won't re-show it.
 */
export function SavedToast() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [show, setShow] = useState(false);

  // Detect ?saved → show + strip the param
  useEffect(() => {
    if (sp.get("saved") == null) return;
    setShow(true);
    const next = new URLSearchParams(sp.toString());
    next.delete("saved");
    router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
  }, [sp, pathname, router]);

  // Auto-hide (kept separate so the strip re-render doesn't cancel the timer)
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setShow(false), 2200);
    return () => clearTimeout(t);
  }, [show]);

  if (!show) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex justify-center px-4 print:hidden">
      <div className="rounded-full bg-europe-green px-4 py-2 text-sm font-semibold text-white shadow-lg">
        ✓ Saved
      </div>
    </div>
  );
}
