"use client";

import { useEffect, useState } from "react";

function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * A datetime-local picker that round-trips through the viewer's OWN timezone.
 * The visible input shows local wall-clock time; a hidden field carries the
 * UTC ISO the form actually submits. Both conversions happen in the browser —
 * server components/actions run in UTC (Vercel), so doing `new Date(localStr)`
 * there would misread the admin's intended time by the tz offset.
 */
export function LocalDateTimeInput({
  name,
  iso,
  className,
}: {
  name: string;
  iso: string | null;
  className?: string;
}) {
  const [local, setLocal] = useState("");
  useEffect(() => {
    if (iso) setLocal(isoToLocalInput(iso));
  }, [iso]);

  // Browser-side conversion to a UTC instant; empty stays empty (→ null).
  const isoValue = local ? new Date(local).toISOString() : "";

  return (
    <>
      <input
        type="datetime-local"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        className={className}
      />
      <input type="hidden" name={name} value={isoValue} />
    </>
  );
}
