"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Inline icons keep the nav dependency-free; stroke inherits currentColor.
const icons: Record<string, React.ReactNode> = {
  Home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <path d="M3 10.5 12 3l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 9.5V20h13V9.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Matches: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <path d="M7 21V4" strokeLinecap="round" />
      <path d="M7 4l9 3-9 3" fill="currentColor" strokeLinejoin="round" />
      <path d="M4.5 21h5" strokeLinecap="round" />
    </svg>
  ),
  Bets: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.5.8-2.5 2s1 1.7 2.5 2c1.5.3 2.5 1 2.5 2s-1.1 2-2.5 2c-1.1 0-2-.4-2.5-1.2" strokeLinecap="round" />
    </svg>
  ),
  Menu: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </svg>
  ),
};

const tabs = [
  { href: "/",        label: "Home"    },
  { href: "/matches", label: "Matches" },
  { href: "/bets",    label: "Bets"    },
  { href: "/menu",    label: "Menu"    },
];

// Pages that live "under" the Menu tab even though their URLs don't start with /menu
const MENU_CHILDREN = ["/menu", "/players", "/history", "/courses", "/admin"];

export function BottomNav() {
  const pathname = usePathname();

  const allTabs = tabs;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-hairline bg-off-white flex pb-[env(safe-area-inset-bottom)] print:hidden">
      {allTabs.map((tab) => {
        const active = tab.href === "/"
          ? pathname === "/"
          : tab.href === "/menu"
          ? MENU_CHILDREN.some((p) => pathname.startsWith(p))
          : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex-1 pt-2 pb-2.5 flex flex-col items-center gap-0.5 text-[11px] font-semibold tracking-wide transition-colors ${
              active ? "text-navy" : "text-navy/35"
            }`}
          >
            {icons[tab.label]}
            <span>{tab.label}</span>
            <span className={`h-0.5 w-6 rounded-full ${active ? "bg-gold" : "bg-transparent"}`} />
          </Link>
        );
      })}
    </nav>
  );
}
