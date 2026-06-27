"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/",        label: "Home"    },
  { href: "/live",    label: "Live"    },
  { href: "/players", label: "Players" },
  { href: "/history", label: "History" },
];

export function BottomNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  const allTabs = isAdmin
    ? [...tabs, { href: "/admin", label: "Admin" }]
    : tabs;

  return (
    <nav className="fixed bottom-0 left-0 right-0 border-t border-hairline bg-off-white flex">
      {allTabs.map((tab) => {
        const active = tab.href === "/"
          ? pathname === "/"
          : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex-1 py-3 text-center text-xs font-semibold tracking-wide transition-colors ${
              active ? "text-navy" : "text-navy/40"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
