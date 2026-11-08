"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const ITEMS = [
  { href: "/home", label: "Home", icon: "M3 11 12 4l9 7v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { href: "/tasks", label: "Chores", icon: "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" },
  { href: "/planner", label: "Planner", icon: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4" },
  { href: "/shopping", label: "Shopping", icon: "M5 7h14l-1.5 9h-11zM9 7V5a3 3 0 0 1 6 0v2M9 20h.01M15 20h.01" },
  { href: "/expenses", label: "Money", icon: "M12 3v18M17 7.5C17 5.6 14.8 5 12 5s-5 .9-5 3 2.2 2.7 5 3.5 5 1.4 5 3.5-2.2 3-5 3-5-.6-5-2.5" },
];

const ADD_ITEMS = [
  { href: "/tasks/new", emoji: "🧽", tone: "bg-mint", label: "A chore or errand", hint: "One-off or repeating" },
  { href: "/shopping#item-name", emoji: "🛒", tone: "bg-peach-100", label: "Something we need", hint: "Goes on the shared list" },
  { href: "/expenses/new", emoji: "💸", tone: "bg-brand-100", label: "A shared cost", hint: "Split it with the house" },
];

function Icon({ d, className = "h-6 w-6" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function NavLink({ it, active }: { it: (typeof ITEMS)[number]; active: boolean }) {
  return (
    <Link href={it.href} aria-current={active ? "page" : undefined}
      className={`flex w-full flex-col items-center gap-0.5 py-1.5 text-[11px] font-bold ${active ? "text-ink" : "text-slate-500"}`}>
      <span className={`flex h-8 w-12 items-center justify-center rounded-xl transition ${active ? "bg-brand-100" : ""}`}>
        <Icon d={it.icon} />
      </span>
      {it.label}
    </Link>
  );
}

/** The one obvious "add" button: chores, shopping items and expenses all start here. */
function AddMenu({ placement }: { placement: "bottom" | "top" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {placement === "bottom" ? (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" aria-label="Add something"
          className={`-mt-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-peach-400 text-white shadow-lg shadow-peach-400/40 transition active:scale-95`}>
          <Icon d="M12 5v14M5 12h14" className={`h-7 w-7 transition-transform ${open ? "rotate-45" : ""}`} />
        </button>
      ) : (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" className="btn-peach min-h-10 px-3.5">
          <Icon d="M12 5v14M5 12h14" className="h-5 w-5" /> Add
        </button>
      )}
      {open && (
        <div role="menu" className={`absolute z-30 w-64 rounded-3xl bg-white p-2 shadow-2xl shadow-ink/20 ring-1 ring-slate-200 ${placement === "bottom" ? "bottom-full left-1/2 mb-8 -translate-x-1/2" : "right-0 top-full mt-2"}`}>
          <p className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wider text-muted">Add something</p>
          {ADD_ITEMS.map((a) => (
            <Link key={a.href} href={a.href} role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-peach-50">
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl ${a.tone}`} aria-hidden>{a.emoji}</span>
              <span>
                <span className="block text-sm font-semibold text-ink">{a.label}</span>
                <span className="block text-xs text-muted">{a.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function BottomNav() {
  const path = usePathname();
  const isActive = (href: string) => path.startsWith(href);
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="mx-auto grid max-w-lg grid-cols-[1fr_1fr_auto_1fr_1fr] items-end px-1">
        {ITEMS.slice(0, 2).map((it) => <li key={it.href}><NavLink it={it} active={isActive(it.href)} /></li>)}
        <li className="flex justify-center px-2 pb-2"><AddMenu placement="bottom" /></li>
        {/* Planner lives in the header on mobile to keep the bar uncluttered; see TopNav. */}
        {ITEMS.slice(3).map((it) => <li key={it.href}><NavLink it={it} active={isActive(it.href)} /></li>)}
      </ul>
    </nav>
  );
}

export function PlannerShortcut() {
  const path = usePathname();
  const active = path.startsWith("/planner");
  return (
    <Link href="/planner" aria-label="Planner" aria-current={active ? "page" : undefined}
      className={`rounded-xl p-2 md:hidden ${active ? "bg-brand-100 text-ink" : "text-ink hover:bg-slate-100"}`}>
      <Icon d={ITEMS[2]!.icon} />
    </Link>
  );
}

export function TopNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="hidden items-center gap-2 md:flex">
      <ul className="flex gap-1">
        {ITEMS.map((it) => {
          const active = path.startsWith(it.href);
          return (
            <li key={it.href}>
              <Link href={it.href} aria-current={active ? "page" : undefined}
                className={`rounded-xl px-3 py-2 text-sm font-bold ${active ? "bg-ink text-white" : "text-slate-600 hover:text-ink"}`}>
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <AddMenu placement="top" />
    </nav>
  );
}
