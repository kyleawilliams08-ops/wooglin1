import { requirePlayer, isAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function AdminPage() {
  const player = await requirePlayer();
  if (!isAdmin(player)) redirect("/");

  const links = [
    { href: "/admin/players", label: "Players", desc: "Manage the player roster" },
    { href: "/admin/events",  label: "Events",  desc: "Create and manage events, teams, and rosters" },
    { href: "/admin/courses", label: "Courses", desc: "Manage courses, tees, and hole data" },
  ];

  return (
    <div className="px-4 py-6 space-y-4">
      <h1 className="text-2xl font-display font-bold text-navy">Admin</h1>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="flex items-center justify-between rounded-xl border border-hairline bg-parchment px-4 py-4 hover:bg-hairline/30 transition-colors"
        >
          <div>
            <p className="font-semibold text-navy">{l.label}</p>
            <p className="text-sm text-navy/50">{l.desc}</p>
          </div>
          <span className="text-navy/30">›</span>
        </Link>
      ))}
    </div>
  );
}
