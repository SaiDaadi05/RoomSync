"use client";

import { useEffect, type ReactNode } from "react";

/**
 * A settings row that opens in place. Collapsed it shows the title and the current value,
 * so people can scan their settings without scrolling past every form.
 */
export function Fold({ id, title, summary, open, children }: { id: string; title: string; summary?: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details id={id} open={open || undefined} className="group scroll-mt-20 border-b border-slate-200 last:border-b-0">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink">{title}</span>
          {summary && <span className="block truncate text-sm text-muted">{summary}</span>}
        </span>
        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-muted transition group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden><path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

/** Opens the folded section a link points at (e.g. /household#away) and scrolls to it. */
export function OpenFromHash() {
  useEffect(() => {
    const open = () => {
      const el = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
      const d = el?.closest("details");
      if (d && !d.open) { d.open = true; el!.scrollIntoView({ block: "start" }); }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
