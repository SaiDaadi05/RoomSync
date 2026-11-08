"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/home", label: "Home", icon: "M3 11 12 4l9 7v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { href: "/tasks", label: "Tasks", icon: "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" },
  { href: "/planner", label: "Planner", icon: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4" },
  { href: "/shopping", label: "Shopping", icon: "M5 7h14l-1.5 9h-11zM9 7V5a3 3 0 0 1 6 0v2M9 20h.01M15 20h.01" },
  { href: "/expenses", label: "Expenses", icon: "M12 3v18M17 7.5C17 5.6 14.8 5 12 5s-5 .9-5 3 2.2 2.7 5 3.5 5 1.4 5 3.5-2.2 3-5 3-5-.6-5-2.5" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function BottomNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="mx-auto flex max-w-lg justify-around">
        {ITEMS.map((it) => {
          const active = path.startsWith(it.href);
          return (
            <li key={it.href}>
              <Link href={it.href} aria-current={active ? "page" : undefined}
                className={`flex min-w-16 flex-col items-center gap-0.5 px-2 py-2 text-[11px] font-medium ${active ? "text-brand-700" : "text-slate-500"}`}>
                <Icon d={it.icon} />
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function TopNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="hidden md:block">
      <ul className="flex gap-1">
        {ITEMS.map((it) => {
          const active = path.startsWith(it.href);
          return (
            <li key={it.href}>
              <Link href={it.href} aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"}`}>
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
