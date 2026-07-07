import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { roundToHalf, formatHcp } from "@/lib/handicap";
import {
  computePlayingHcps,
  strokesOnHole,
  isOneScoreFormat,
} from "@/lib/matchcalc";

type EPRef = { display_name: string; player_id: string | null } | null;

function holeNums(side: string): number[] {
  if (side === "front") return Array.from({ length: 9 }, (_, i) => i + 1);
  if (side === "back")  return Array.from({ length: 9 }, (_, i) => i + 10);
  return Array.from({ length: 18 }, (_, i) => i + 1);
}

function fmtTeeTime(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, "0")} ${ampm}`;
}

// Paper backup scorecard: landscape, logo header, handicap math, stroke dots,
// and EMPTY boxes for writing scores when the app is having a bad day.
export default async function PrintScorecardPage({
  params,
}: {
  params: { matchupId: string };
}) {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const supabase = createClient();

  const { data: matchupRaw } = await supabase
    .from("matchups")
    .select(`
      id, round_id, match_number, tee_time,
      home_p1:event_participants!matchups_home_p1_id_fkey(display_name, player_id),
      home_p2:event_participants!matchups_home_p2_id_fkey(display_name, player_id),
      away_p1:event_participants!matchups_away_p1_id_fkey(display_name, player_id),
      away_p2:event_participants!matchups_away_p2_id_fkey(display_name, player_id)
    `)
    .eq("id", params.matchupId)
    .single();
  const matchup = matchupRaw as unknown as {
    id: string; round_id: string; match_number: number; tee_time: string | null;
    home_p1: EPRef; home_p2: EPRef; away_p1: EPRef; away_p2: EPRef;
  } | null;
  if (!matchup) redirect("/matches");

  const { data: roundRaw } = await supabase
    .from("rounds")
    .select("id, event_id, round_number, name, side, played_at, course_tee_id, formats(name, hcp_allowance, hcp_allowance_secondary), course_tees(tee_name, rating, slope, par, courses(name))")
    .eq("id", matchup.round_id)
    .single();
  const round = roundRaw as unknown as {
    id: string; event_id: string; round_number: number; name: string | null; side: string;
    played_at: string | null; course_tee_id: string;
    formats: { name: string; hcp_allowance: number; hcp_allowance_secondary: number | null } | null;
    course_tees: { tee_name: string; rating: number; slope: number; par: number; courses: { name: string } | null } | null;
  } | null;
  if (!round?.formats) redirect("/matches");

  const fmt = round.formats!;
  const nineHole = round.side !== "full";

  const { data: event } = await supabase
    .from("events").select("name, year, location").eq("id", round.event_id).single();
  const { data: teams } = await supabase
    .from("teams").select("id, name, color").eq("event_id", round.event_id).order("name");
  const homeTeam = teams?.[0];
  const awayTeam = teams?.[1];

  const relevant = holeNums(round.side);
  const { data: holesRaw } = await supabase
    .from("holes")
    .select("hole_number, par, stroke_index")
    .eq("course_tee_id", round.course_tee_id)
    .in("hole_number", relevant)
    .order("hole_number");
  const holes = holesRaw ?? [];
  const allHoleSIs = holes.map((h) => h.stroke_index);

  const pids = [
    matchup.home_p1?.player_id, matchup.home_p2?.player_id,
    matchup.away_p1?.player_id, matchup.away_p2?.player_id,
  ].filter(Boolean) as string[];
  const { data: hcpRows } = await supabase
    .from("participant_handicaps")
    .select("player_id, calculated_hcp, override_hcp")
    .eq("event_id", round.event_id)
    .eq("course_tee_id", round.course_tee_id)
    .in("player_id", pids.length > 0 ? pids : ["00000000-0000-0000-0000-000000000000"]);
  const effectiveHcp = (pid: string | null | undefined): number => {
    if (!pid) return 0;
    const row = hcpRows?.find((h) => h.player_id === pid);
    return row?.override_hcp ?? row?.calculated_hcp ?? 0;
  };

  const hp1CH = effectiveHcp(matchup.home_p1?.player_id);
  const hp2CH = matchup.home_p2 ? effectiveHcp(matchup.home_p2.player_id) : null;
  const ap1CH = effectiveHcp(matchup.away_p1?.player_id);
  const ap2CH = matchup.away_p2 ? effectiveHcp(matchup.away_p2.player_id) : null;
  const phcps = computePlayingHcps(fmt, { homeP1: hp1CH, homeP2: hp2CH, awayP1: ap1CH, awayP2: ap2CH }, nineHole);
  const oneScore = isOneScoreFormat(fmt.name);

  // One writing row per ball (phcp null = TBD lineup, handicap written in by hand)
  type Row = { label: string; team: string; color: string; phcp: number | null; ch: number | null };
  const rows: Row[] = [];
  const hc = homeTeam?.color ?? "#0C2D55";
  const ac = awayTeam?.color ?? "#0C2D55";
  // Blank write-in rows keep the card usable when lineups aren't set yet
  const singles = fmt.name === "Singles";
  const blank = "________________";
  if (oneScore) {
    const homeNames = [matchup.home_p1?.display_name, matchup.home_p2?.display_name].filter(Boolean).join(" / ");
    const awayNames = [matchup.away_p1?.display_name, matchup.away_p2?.display_name].filter(Boolean).join(" / ");
    rows.push({ label: `${homeTeam?.name ?? "Home"} — ${homeNames || blank}`, team: homeTeam?.name ?? "Home", color: hc, phcp: phcps.homeTeam ?? 0, ch: null });
    rows.push({ label: `${awayTeam?.name ?? "Away"} — ${awayNames || blank}`, team: awayTeam?.name ?? "Away", color: ac, phcp: phcps.awayTeam ?? 0, ch: null });
  } else {
    if (matchup.home_p1) rows.push({ label: matchup.home_p1.display_name, team: homeTeam?.name ?? "Home", color: hc, phcp: phcps.homeP1, ch: hp1CH });
    if (matchup.home_p2) rows.push({ label: matchup.home_p2.display_name, team: homeTeam?.name ?? "Home", color: hc, phcp: phcps.homeP2 ?? 0, ch: hp2CH });
    if (!matchup.home_p1 && !matchup.home_p2) {
      for (let i = 0; i < (singles ? 1 : 2); i++) {
        rows.push({ label: blank, team: homeTeam?.name ?? "Home", color: hc, phcp: null, ch: null });
      }
    }
    if (matchup.away_p1) rows.push({ label: matchup.away_p1.display_name, team: awayTeam?.name ?? "Away", color: ac, phcp: phcps.awayP1, ch: ap1CH });
    if (matchup.away_p2) rows.push({ label: matchup.away_p2.display_name, team: awayTeam?.name ?? "Away", color: ac, phcp: phcps.awayP2 ?? 0, ch: ap2CH });
    if (!matchup.away_p1 && !matchup.away_p2) {
      for (let i = 0; i < (singles ? 1 : 2); i++) {
        rows.push({ label: blank, team: awayTeam?.name ?? "Away", color: ac, phcp: null, ch: null });
      }
    }
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

  const sideLabel: Record<string, string> = { front: "Front 9", back: "Back 9", full: "Full 18" };
  const tee = round.course_tees;

  return (
    <div className="mx-auto max-w-[10.5in] px-4 py-4 space-y-3 bg-white text-navy">
      <style>{`@media print { @page { size: landscape; margin: 8mm; } }`}</style>

      {/* Screen-only controls */}
      <div className="flex items-center justify-between print:hidden">
        <Link href="/matches" className="text-sm text-navy/50 hover:text-navy">← Matches</Link>
        <PrintButton />
      </div>

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
          <p className="font-bold text-sm">Match {matchup.match_number} · R{round.round_number}{round.name ? ` — ${round.name}` : ""}</p>
          <p>{tee?.courses?.name} · {tee?.tee_name} Tees ({tee?.rating}/{tee?.slope}) · {sideLabel[round.side]}</p>
          <p className="font-semibold">{fmt.name}{fmtTeeTime(matchup.tee_time) ? ` · Tee ${fmtTeeTime(matchup.tee_time)}` : ""}</p>
        </div>
      </div>

      {/* Handicap math */}
      <div className="grid grid-cols-2 gap-3 text-[11px] leading-snug">
        <div className="rounded border border-navy/30 p-2">
          <p className="font-bold" style={{ color: hc }}>{homeTeam?.name ?? "Home"}</p>
          {oneScore ? (
            <>
              {matchup.home_p1 && <p>{matchup.home_p1.display_name}: {chain(hp1CH, hp1CH <= (hp2CH ?? 999) ? pct : pct2)}</p>}
              {matchup.home_p2 && hp2CH !== null && <p>{matchup.home_p2.display_name}: {chain(hp2CH, hp2CH < hp1CH ? pct : pct2)}</p>}
              <p className="font-semibold">Team plays: {phcps.homeTeam ?? 0} (normalized)</p>
            </>
          ) : (
            <>
              {matchup.home_p1 && <p>{matchup.home_p1.display_name}: {chain(hp1CH, pct)} → plays {phcps.homeP1}</p>}
              {matchup.home_p2 && <p>{matchup.home_p2.display_name}: {chain(hp2CH ?? 0, pct)} → plays {phcps.homeP2 ?? 0}</p>}
            </>
          )}
        </div>
        <div className="rounded border border-navy/30 p-2">
          <p className="font-bold" style={{ color: ac }}>{awayTeam?.name ?? "Away"}</p>
          {oneScore ? (
            <>
              {matchup.away_p1 && <p>{matchup.away_p1.display_name}: {chain(ap1CH, ap1CH <= (ap2CH ?? 999) ? pct : pct2)}</p>}
              {matchup.away_p2 && ap2CH !== null && <p>{matchup.away_p2.display_name}: {chain(ap2CH, ap2CH < ap1CH ? pct : pct2)}</p>}
              <p className="font-semibold">Team plays: {phcps.awayTeam ?? 0} (normalized)</p>
            </>
          ) : (
            <>
              {matchup.away_p1 && <p>{matchup.away_p1.display_name}: {chain(ap1CH, pct)} → plays {phcps.awayP1}</p>}
              {matchup.away_p2 && <p>{matchup.away_p2.display_name}: {chain(ap2CH ?? 0, pct)} → plays {phcps.awayP2 ?? 0}</p>}
            </>
          )}
        </div>
      </div>

      {/* Scorecard grid: holes as columns, one writing row per ball */}
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="border border-navy bg-navy px-1.5 py-1 text-left text-off-white w-40">Hole</th>
            {holes.map((h) => (
              <th key={h.hole_number} className="border border-navy bg-navy px-1 py-1 text-center text-off-white">
                {h.hole_number}
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
            <tr key={r.label}>
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
        <p>● = stroke on hole · ●● = 2 strokes · ½ = half stroke (wins ties)</p>
        <div className="flex gap-8">
          <p>Final result: ______________________</p>
          <p>Attest: ______________________</p>
        </div>
      </div>
    </div>
  );
}
