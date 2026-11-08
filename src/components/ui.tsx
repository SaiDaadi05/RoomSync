import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[1.9rem] font-extrabold leading-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Section titles may end in " · <n>" (e.g. "Overdue · 3"); the count is shown as a small coral pill. */
export function Section({ title, action, hint, children }: { title: string; action?: ReactNode; hint?: ReactNode; children: ReactNode }) {
  const m = /^(.*) · (\d+)$/.exec(title);
  const label = m ? m[1] : title;
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-extrabold text-ink">
          {label}
          {m && <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-peach-400 px-2 text-xs font-bold text-white">{m[2]}</span>}
        </h2>
        {action}
      </div>
      {hint && <p className="-mt-1.5 mb-3 text-sm text-muted">{hint}</p>}
      {children}
    </section>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: string; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-8 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-peach-100 text-3xl" aria-hidden>{icon}</div>
      <p className="text-base font-extrabold text-ink">{title}</p>
      {body && <p className="mt-1 max-w-xs text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** App mark: a navy tile with a house-and-check, plus a coral dot. */
export function Logo({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="18" fill="var(--color-ink)" />
      <path d="M14 33 32 17l18 16v15a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3z" fill="#fff" />
      <path d="m24 37 6 6 11-12" stroke="var(--color-ink)" strokeWidth="4.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="50" cy="14" r="6.5" fill="var(--color-peach-400)" />
    </svg>
  );
}

const AVATAR_COLORS = ["bg-peach-100 text-peach-700", "bg-brand-100 text-ink", "bg-mint text-emerald-800", "bg-amber-100 text-amber-900", "bg-sky-100 text-sky-900", "bg-rose-100 text-rose-800"];

export function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function Avatar({ id, name, size = "md" }: { id: string; name: string; size?: "sm" | "md" | "lg" }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
  const s = size === "sm" ? "h-7 w-7 text-[11px]" : size === "lg" ? "h-11 w-11 text-base" : "h-9 w-9 text-sm";
  return (
    <span title={name} className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${s} ${colorFor(id)}`}>
      {initials}
    </span>
  );
}

export function Badge({ tone = "slate", children }: { tone?: "slate" | "green" | "amber" | "red" | "blue" | "violet"; children: ReactNode }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-mint text-emerald-800",
    amber: "bg-amber-100 text-amber-900",
    red: "bg-peach-100 text-peach-700",
    blue: "bg-brand-100 text-ink",
    violet: "bg-brand-100 text-ink",
  };
  return <span className={`chip ${tones[tone]}`}>{children}</span>;
}

export function LinkButton({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" | "ghost" | "peach" }) {
  return <Link href={href} className={`btn-${variant}`}>{children}</Link>;
}

export function DemoBanner() {
  return (
    <div className="bg-ink px-4 py-1.5 text-center text-xs font-semibold text-white" role="status">
      Demo mode: sample household with made-up data. Nothing here is real or shared with real accounts.
    </div>
  );
}
