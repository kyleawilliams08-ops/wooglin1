import { requirePlayer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

// The Menu: clubhouse pages everyone can see, plus commissioner tools for admins.
export default async function MenuPage() {
  const player = await requirePlayer();

  // Captains (of any event) get the draft prep sheet alongside admins — it's
  // their pre-draft homework, and keeps the Menu clean for everyone else.
  const supabase = createClient();
  const { data: captaincies } = await supabase
    .from("event_participants").select("id")
    .eq("player_id", player.id).eq("is_captain", true).limit(1);
  const isCaptain = (captaincies?.length ?? 0) > 0;

  const clubhouse = [
    ...(isCaptain || isAdmin(player)
      ? [{ href: "/draft/prep", label: "Draft Prep", desc: "Indexes & course handicaps for the field" }]
      : []),
    { href: "/players", label: "Player Cards", desc: "Appearances, records & profiles" },
    { href: "/history", label: "History",      desc: "Past cups and champions" },
    { href: "/courses", label: "Courses",      desc: "Courses, tees & ratings" },
  ];

  const commissioner = [
    { href: "/admin/events",  label: "Events",         desc: "Events, teams, rosters, rounds & matchups" },
    { href: "/admin/alerts",  label: "Admin Alerts",   desc: "Full-screen notices everyone must acknowledge" },
    { href: "/admin/players", label: "Player Roster",  desc: "Players, emails & handicap indexes" },
    { href: "/admin/courses", label: "Manage Courses", desc: "Course, tee & hole setup" },
    { href: "/admin/formats", label: "Formats",        desc: "Handicap allowances per format" },
    { href: "/admin/history", label: "Edit History",   desc: "Backfill past cup results" },
  ];

  const card = "flex items-center justify-between rounded-xl border border-hairline px-4 py-4 transition-colors";

  return (
    <div className="px-4 py-6 space-y-6">
      <h1 className="text-2xl font-display font-bold text-navy">Menu</h1>

      <div className="space-y-2">
        {clubhouse.map((l) => (
          <Link key={l.href} href={l.href} className={`${card} bg-white hover:bg-parchment`}>
            <div>
              <p className="font-semibold text-navy">{l.label}</p>
              <p className="text-sm text-navy/50">{l.desc}</p>
            </div>
            <span className="text-navy/30">›</span>
          </Link>
        ))}
      </div>

      {isAdmin(player) && (
        <div>
          <p className="text-xs font-semibold text-navy/50 uppercase tracking-wide mb-2">
            Commissioner Tools
          </p>
          <div className="space-y-2">
            {commissioner.map((l) => (
              <Link key={l.href} href={l.href} className={`${card} bg-parchment hover:bg-hairline/30`}>
                <div>
                  <p className="font-semibold text-navy">{l.label}</p>
                  <p className="text-sm text-navy/50">{l.desc}</p>
                </div>
                <span className="text-navy/30">›</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
