import Image from "next/image";
import { roundToHalf, formatHcp } from "@/lib/handicap";
import {
  computePlayingHcps,
  strokesOnHole,
  isOneScoreFormat,
  type FormatInfo,
} from "@/lib/matchcalc";

export type PrintEPRef = { display_name: string; player_id: string | null } | null;

export interface PrintCardData {
  event: { name: string; year: number; location: string | null } | null;
  round: {
    round_number: number;
    name: string | null;
    side: string;
    played_at: string | null;
    course_tees: {
      tee_name: string; rating: number; slope: number; par: number;
      courses: { name: string } | null;
    } | null;
  };
  /** Format this card is played under (match override already resolved) */
  fmt: FormatInfo;
  holes: { hole_number: number; par: number; stroke_index: number }[];
  homeTeam?: { name: string; color: string };
  awayTeam?: { name: string; color: string };
  /** null match_number = a generic blank card (no tee-time slot behind it) */
  matchup: {
    match_number: number | null;
    tee_time: string | null;
    home_p1: PrintEPRef; home_p2: PrintEPRef;
    away_p1: PrintEPRef; away_p2: PrintEPRef;
  };
  /** Effective course handicap for a player at this round's tee */
  hcpOf: (playerId: string | null | undefined) => number;
  /** Closest-to-the-pin holes in this round */
  ctpHoles: number[];
}

export function fmtTeeTime(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, "0")} ${ampm}`;
}

/**
 * One paper scorecard: logo header, handicap math, stroke dots, and EMPTY
 * boxes for writing scores. Lineups that aren't set yet print as write-in
 * rows (names + "plays ____" by hand), so cards can be printed before the
 * nightly pairing draft. Shared by /print/match/[id] and /print/round/[id].
 */
export function PrintScorecard({
  event, round, fmt, holes, homeTeam, awayTeam, matchup, hcpOf, ctpHoles,
}: PrintCardData) {
  const nineHole = round.side !== "full";
  const allHoleSIs = holes.map((h) => h.stroke_index);
  const ctp = new Set(ctpHoles);

  const hp1CH = hcpOf(matchup.home_p1?.player_id);
  const hp2CH = matchup.home_p2 ? hcpOf(matchup.home_p2.player_id) : null;
  const ap1CH = hcpOf(matchup.away_p1?.player_id);
  const ap2CH = matchup.away_p2 ? hcpOf(matchup.away_p2.player_id) : null;
  const phcps = computePlayingHcps(fmt, { homeP1: hp1CH, homeP2: hp2CH, awayP1: ap1CH, awayP2: ap2CH }, nineHole);
  const oneScore = isOneScoreFormat(fmt.name);

  const homeSet = !!(matchup.home_p1 || matchup.home_p2);
  const awaySet = !!(matchup.away_p1 || matchup.away_p2);
  // Strokes are relative to the low man across BOTH sides, so they only mean
  // something once the whole match is set.
  const strokesKnown = homeSet && awaySet;

  // One writing row per ball (phcp null = TBD lineup, handicap written in by hand)
  type Row = { key: string; label: string; color: string; phcp: number | null; ch: number | null };
  const rows: Row[] = [];
  const hc = homeTeam?.color ?? "#0C2D55";
  const ac = awayTeam?.color ?? "#0C2D55";
  const singles = fmt.name === "Singles";
  const blank = "________________";

  if (oneScore) {
    const homeNames = [matchup.home_p1?.display_name, matchup.home_p2?.display_name].filter(Boolean).join(" / ");
    const awayNames = [matchup.away_p1?.display_name, matchup.away_p2?.display_name].filter(Boolean).join(" / ");
    rows.push({ key: "h", label: `${homeTeam?.name ?? "Home"} — ${homeNames || blank}`, color: hc, phcp: strokesKnown ? phcps.homeTeam ?? 0 : null, ch: null });
    rows.push({ key: "a", label: `${awayTeam?.name ?? "Away"} — ${awayNames || blank}`, color: ac, phcp: strokesKnown ? phcps.awayTeam ?? 0 : null, ch: null });
  } else {
    const side = (
      prefix: string, p1: PrintEPRef, p2: PrintEPRef, color: string,
      p1CH: number, p2CH: number | null, p1Plays: number, p2Plays: number | null,
    ) => {
      if (p1) rows.push({ key: `${prefix}1`, label: p1.display_name, color, phcp: strokesKnown ? p1Plays : null, ch: p1CH });
      if (p2) rows.push({ key: `${prefix}2`, label: p2.display_name, color, phcp: strokesKnown ? p2Plays ?? 0 : null, ch: p2CH });
      if (!p1 && !p2) {
        for (let i = 0; i < (singles ? 1 : 2); i++) {
          rows.push({ key: `${prefix}b${i}`, label: blank, color, phcp: null, ch: null });
        }
      }
    };
    side("h", matchup.home_p1, matchup.home_p2, hc, hp1CH, hp2CH, phcps.homeP1, phcps.homeP2);
    side("a", matchup.away_p1, matchup.away_p2, ac, ap1CH, ap2CH, phcps.awayP1, phcps.awayP2);
  }

  const strokeMark = (phcp: number, rawSI: number) => {
    const s = strokesOnHole(phcp, rawSI, allHoleSIs, nineHole);
    if (s <= 0) return "";
    const dots = "●".repeat(Math.floor(s));
    return s % 1 > 0 ? `${dots}½` : dots;
  };

  // Handicap chain text per player (matches the app's breakdown)
  const chain = (ch: number, pct: number) => {
    const base = nineHole ? ch / 2 : ch;
    const raw = base * (pct / 100);
    return `${formatHcp(ch)}${nineHole ? ` → 9-hole ${formatHcp(Math.round(base * 10) / 10)}` : ""} × ${pct}% → ${formatHcp(roundToHalf(raw))}`;
  };
  const pct = fmt.hcp_allowance;
  const pct2 = fmt.hcp_allowance_secondary ?? 0;
  const allowance = pct2 ? `${pct}% low / ${pct2}% high` : `${pct}%`;

  const sideLabel: Record<string, string> = { front: "Front 9", back: "Back 9", full: "Full 18" };
  const tee = round.course_tees;

  const mathBox = (
    teamName: string, color: string, isSet: boolean,
    p1: PrintEPRef, p2: PrintEPRef, p1CH: number, p2CH: number | null,
    p1Plays: number, p2Plays: number | null, teamPlays: number | null,
  ) => (
    <div className="rounded border border-navy/30 p-2">
      <p className="font-bold" style={{ color }}>{teamName}</p>
      {!isSet ? (
        <p className="text-navy/50">Lineup TBD — write in names &amp; strokes after the draft.</p>
      ) : oneScore ? (
        <>
          {p1 && <p>{p1.display_name}: {chain(p1CH, p1CH <= (p2CH ?? 999) ? pct : pct2)}</p>}
          {p2 && p2CH !== null && <p>{p2.display_name}: {chain(p2CH, p2CH < p1CH ? pct : pct2)}</p>}
          <p className="font-semibold">Team plays: {strokesKnown ? teamPlays ?? 0 : "____"}{strokesKnown ? " (normalized)" : ""}</p>
        </>
      ) : (
        <>
          {p1 && <p>{p1.display_name}: {chain(p1CH, pct)} → plays {strokesKnown ? p1Plays : "____"}</p>}
          {p2 && <p>{p2.display_name}: {chain(p2CH ?? 0, pct)} → plays {strokesKnown ? p2Plays ?? 0 : "____"}</p>}
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-3 bg-white text-navy">
      {/* Card header */}
      <div className="flex items-center justify-between border-b-2 border-navy pb-2">
        <div className="flex items-center gap-3">
          <Image src="/crest-small.png" alt="" width={48} height={48} />
          <div>
            <p className="font-display text-xl font-bold leading-tight">{event?.name ?? "Wooglin Cup"}</p>
            <p className="text-xs text-navy/60">
              {event?.location ? `${event.location} · ` : ""}{event?.year}
              {round.played_at ? ` · ${round.played_at}` : ""}
            </p>
          </div>
        </div>
        <div className="text-right text-xs">
          <p className="font-bold text-sm">
            Match {matchup.match_number ?? "____"} · R{round.round_number}{round.name ? ` — ${round.name}` : ""}
          </p>
          <p>{tee?.courses?.name} · {tee?.tee_name} Tees ({tee?.rating}/{tee?.slope}) · {sideLabel[round.side]}</p>
          <p className="font-semibold">
            {fmt.name} · {allowance}
            {fmtTeeTime(matchup.tee_time) ? ` · Tee ${fmtTeeTime(matchup.tee_time)}` : matchup.match_number === null ? " · Tee ________" : ""}
          </p>
        </div>
      </div>

      {/* Handicap math */}
      <div className="grid grid-cols-2 gap-3 text-[11px] leading-snug">
        {mathBox(homeTeam?.name ?? "Home", hc, homeSet, matchup.home_p1, matchup.home_p2, hp1CH, hp2CH, phcps.homeP1, phcps.homeP2, phcps.homeTeam)}
        {mathBox(awayTeam?.name ?? "Away", ac, awaySet, matchup.away_p1, matchup.away_p2, ap1CH, ap2CH, phcps.awayP1, phcps.awayP2, phcps.awayTeam)}
      </div>

      {/* Scorecard grid: holes as columns, one writing row per ball */}
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="border border-navy bg-navy px-1.5 py-1 text-left text-off-white w-40">Hole</th>
            {holes.map((h) => (
              <th key={h.hole_number} className="border border-navy bg-navy px-1 py-1 text-center text-off-white">
                {h.hole_number}
                {ctp.has(h.hole_number) && (
                  <span className="block text-[8px] font-bold leading-none text-gold">CTP</span>
                )}
              </th>
            ))}
            <th className="border border-navy bg-navy px-1.5 py-1 text-center text-off-white w-12">
              {nineHole ? "Total" : "Tot"}
            </th>
          </tr>
          <tr>
            <th className="border border-navy/40 px-1.5 py-0.5 text-left font-semibold">Par</th>
            {holes.map((h) => (
              <td key={h.hole_number} className="border border-navy/40 px-1 py-0.5 text-center font-semibold">{h.par}</td>
            ))}
            <td className="border border-navy/40 px-1 py-0.5 text-center font-bold">
              {holes.reduce((a, h) => a + h.par, 0)}
            </td>
          </tr>
          <tr>
            <th className="border border-navy/40 px-1.5 py-0.5 text-left text-navy/60">SI</th>
            {holes.map((h) => (
              <td key={h.hole_number} className="border border-navy/40 px-1 py-0.5 text-center text-navy/60">{h.stroke_index}</td>
            ))}
            <td className="border border-navy/40" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="border border-navy/40 px-1.5 py-3 align-top">
                <span className="font-bold" style={{ color: r.color }}>{r.label}</span>
                <span className="block text-[9px] text-navy/50">
                  {r.ch != null ? `CH ${formatHcp(r.ch)} · ` : ""}plays {r.phcp ?? "____"}
                </span>
              </td>
              {holes.map((h) => (
                <td key={h.hole_number} className="relative border border-navy/40 px-1 py-3">
                  <span className="absolute left-0.5 top-0 text-[8px] text-navy/50">
                    {r.phcp != null ? strokeMark(r.phcp, h.stroke_index) : ""}
                  </span>
                </td>
              ))}
              <td className="border border-navy/40" />
            </tr>
          ))}
          {/* Running match status row for the marker */}
          <tr>
            <td className="border border-navy/40 px-1.5 py-2.5 text-[10px] font-semibold text-navy/60">
              Match status
            </td>
            {holes.map((h) => (
              <td key={h.hole_number} className="border border-navy/40 py-2.5" />
            ))}
            <td className="border border-navy/40" />
          </tr>
        </tbody>
      </table>

      {/* Footer */}
      <div className="flex items-end justify-between text-[10px] text-navy/60">
        <p>
          ● = stroke on hole · ●● = 2 strokes · ½ = half stroke (wins ties)
          {ctpHoles.length > 0 ? ` · CTP = closest to the pin (#${[...ctpHoles].sort((a, b) => a - b).join(", #")})` : ""}
        </p>
        <div className="flex gap-8">
          <p>Final result: ______________________</p>
          <p>Attest: ______________________</p>
        </div>
      </div>
    </div>
  );
}
