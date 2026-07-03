import Image from "next/image";

export interface PlayerCardProps {
  name: string;
  nickname: string | null;
  role: string;
  index: number | null;
  avatarUrl?: string | null;
  appearances: { year: number; result: "W" | "L" | "T" }[];
  /** Full span of cup years for the timeline, e.g. 2014..2025 */
  allYears: number[];
  /** Latest completed cup year — used for the reigning-champ badge */
  latestYear: number | null;
  /** Team from the current or most recent cup (teams reshuffle yearly) */
  team?: { name: string; color: string; year: number; current: boolean } | null;
}

/** Trading-card style player profile header. */
export function PlayerCard({
  name,
  nickname,
  role,
  index,
  avatarUrl,
  appearances,
  allYears,
  latestYear,
  team,
}: PlayerCardProps) {
  const displayName = nickname ?? name;
  const initials = displayName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const byYear = new Map(appearances.map((a) => [a.year, a.result]));
  const wins   = appearances.filter((a) => a.result === "W").length;
  const losses = appearances.filter((a) => a.result === "L").length;
  const ties   = appearances.filter((a) => a.result === "T").length;
  const winPct = appearances.length > 0 ? Math.round((wins / appearances.length) * 100) : null;

  const reigning = latestYear != null && byYear.get(latestYear) === "W";
  const roleBadge =
    role === "admin" ? "Commish" :
    role === "assistant" ? "Asst. Commish" :
    role === "captain" ? "Captain" : null;

  return (
    <div className="relative overflow-hidden rounded-2xl border-2 border-navy bg-parchment shadow-lg">
      {/* gold inner frame */}
      <div className="pointer-events-none absolute inset-1.5 z-10 rounded-xl border border-gold/50" />

      {/* crest watermark */}
      <Image
        src="/crest.png"
        alt=""
        width={200}
        height={200}
        className="absolute -bottom-8 -right-8 w-44 rotate-[-8deg] opacity-[0.07]"
      />

      {/* header band */}
      <div className="relative flex items-center justify-between bg-navy px-4 py-2">
        <span className="text-[10px] font-semibold tracking-[0.25em] text-gold">WOOGLIN CUP</span>
        <span className="text-[10px] tracking-widest text-off-white/50">EST. 2014</span>
      </div>

      <div className="relative px-5 pb-5 pt-4">
        {/* identity — avatar wears the current/most recent cup's team color */}
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt={displayName}
              className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-gold"
              style={{ borderColor: team?.color ?? "#0C2D55", borderWidth: 2 }}
            />
          ) : (
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full font-display text-2xl font-bold text-off-white ring-2 ring-gold"
              style={{ backgroundColor: team?.color ?? "#0C2D55" }}
            >
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate font-display text-2xl font-bold leading-tight text-navy">
              {displayName}
            </p>
            {nickname && nickname !== name && (
              <p className="truncate text-xs text-navy/50">{name}</p>
            )}
            <div className="mt-1 flex flex-wrap gap-1.5">
              {team && (
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                  style={{ backgroundColor: team.color }}
                >
                  {team.name} {team.current ? "· Current" : `’${String(team.year).slice(2)}`}
                </span>
              )}
              {reigning && (
                <span className="rounded-full bg-gold px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-navy">
                  🏆 Reigning Champ
                </span>
              )}
              {roleBadge && (
                <span className="rounded-full border border-navy/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-navy/60">
                  {roleBadge}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* stat row */}
        <div className="mt-4 grid grid-cols-3 divide-x divide-hairline rounded-xl border border-hairline bg-white text-center">
          <div className="px-2 py-3">
            <p className="text-2xl font-bold tabular-nums text-navy">{index ?? "—"}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-navy/50">Index</p>
          </div>
          <div className="px-2 py-3">
            <p className="text-2xl font-bold tabular-nums text-navy">{appearances.length}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-navy/50">Appearances</p>
          </div>
          <div className="px-2 py-3">
            <p className="text-2xl font-bold tabular-nums text-navy">
              {wins}–{losses}{ties > 0 ? `–${ties}` : ""}
            </p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-navy/50">
              Cup Record{winPct != null ? ` · ${winPct}%` : ""}
            </p>
          </div>
        </div>

        {/* career timeline */}
        {allYears.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-[10px] uppercase tracking-wide text-navy/40">Career</p>
            <div className="flex flex-wrap gap-1">
              {allYears.map((y) => {
                const r = byYear.get(y);
                const cls =
                  r === "W" ? "bg-europe-green text-white border-europe-green"
                  : r === "L" ? "bg-usa-red text-white border-usa-red"
                  : r === "T" ? "bg-navy/20 text-navy border-navy/20"
                  : "bg-transparent text-navy/25 border-hairline";
                return (
                  <span
                    key={y}
                    title={`${y}${r ? ` — ${r === "W" ? "Won" : r === "L" ? "Lost" : "Tied"}` : " — did not play"}`}
                    className={`rounded-md border px-1.5 py-1 text-[10px] font-bold tabular-nums ${cls}`}
                  >
                    ’{String(y).slice(2)}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
