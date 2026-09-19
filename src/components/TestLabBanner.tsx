import Link from "next/link";
import { exitTestMode, stopMasquerade } from "@/lib/testLabActions";

/**
 * Always-on strip while an admin is in test mode and/or viewing as another
 * player — so it's never ambiguous whose eyes, or which event, you're on, and
 * the exit is one tap away even when the masqueraded player has no admin menu.
 */
export function TestLabBanner({
  viewingAs,
  testEventName,
}: {
  viewingAs: string | null;
  testEventName: string | null;
}) {
  if (!viewingAs && !testEventName) return null;
  const exit = "rounded-full bg-navy/10 px-2.5 py-0.5 font-bold text-navy hover:bg-navy/20";
  return (
    <div className="sticky top-0 z-[70] flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-gold px-3 py-1.5 text-xs font-semibold text-navy print:hidden">
      {viewingAs && (
        <form action={stopMasquerade} className="flex items-center gap-2">
          <span>👁 Viewing as {viewingAs}</span>
          <button className={exit}>Exit</button>
        </form>
      )}
      {testEventName && (
        <form action={exitTestMode} className="flex items-center gap-2">
          <span>🧪 {testEventName}</span>
          <button className={exit}>Exit</button>
        </form>
      )}
      <Link href="/admin/test-lab" className="underline underline-offset-2">Test Lab</Link>
    </div>
  );
}
