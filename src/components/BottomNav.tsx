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
  Live: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <path d="M7 21V4" strokeLinecap="round" />
      <path d="M7 4l9 3-9 3" fill="currentColor" strokeLinejoin="round" />
      <path d="M4.5 21h5" strokeLinecap="round" />
    </svg>
  ),
  History: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 6H4.5a0 0 0 0 0 0 0c0 2.5 1 4 2.5 4.5M17 6h2.5c0 2.5-1 4-2.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Admin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19 12a7 7 0 0 0-.14-1.4l2-1.55-2-3.46-2.36.95a7 7 0 0 0-2.42-1.4L13.7 2.6h-3.4l-.38 2.54a7 7 0 0 0-2.42 1.4l-2.36-.95-2 3.46 2 1.55A7 7 0 0 0 5 12c0 .48.05.94.14 1.4l-2 1.55 2 3.46 2.36-.95a7 7 0 0 0 2.42 1.4l.38 2.54h3.4l.38-2.54a7 7 0 0 0 2.42-1.4l2.36.95 2-3.46-2-1.55c.09-.46.14-.92.14-1.4Z" strokeLinejoin="round" />
    </svg>
  ),
};

const tabs = [
  { href: "/",        label: "Home"    },
  { href: "/live",    label: "Live"    },
  { href: "/history", label: "History" },
];

export function BottomNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  const allTabs = isAdmin
    ? [...tabs, { href: "/admin", label: "Admin" }]
    : tabs;

  return (
    <nav className="fixed bottom-0 left-0 right-0 border-t border-hairline bg-off-white flex pb-[env(safe-area-inset-bottom)]">
      {allTabs.map((tab) => {
        const active = tab.href === "/"
          ? pathname === "/"
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
