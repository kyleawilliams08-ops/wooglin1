"use client";

import { useEffect, useState } from "react";

/**
 * Formats an ISO timestamp in the viewer's OWN timezone. Use this anywhere a
 * user-facing date/time is rendered from a server component — server
 * components render in the server's timezone (UTC on Vercel), so formatting a
 * timestamptz there shows the wrong wall-clock time. This defers formatting to
 * the browser after mount (with the raw fallback during SSR/first paint).
 */
export function LocalDate({
  iso,
  options,
  fallback = "…",
}: {
  iso: string;
  options: Intl.DateTimeFormatOptions;
  fallback?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(new Date(iso).toLocaleDateString("en-US", options));
    // options is passed inline; iso is the meaningful dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso]);
  return <span suppressHydrationWarning>{text ?? fallback}</span>;
}
