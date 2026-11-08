import Link from "next/link";
import type { TaskDefinition, TaskOccurrence } from "@prisma/client";
import { Avatar, Badge } from "./ui";
import { completeAction, reopenAction, claimAction } from "@/app/actions/tasks";
import { formatDue } from "@/lib/time";

type Member = { id: string; name: string };
export type OccWithDef = TaskOccurrence & { definition: TaskDefinition };

export const CATEGORY_EMOJI: Record<string, string> = {
  cleaning: "🧽", kitchen: "🍳", trash: "🗑️", laundry: "🧺", bathroom: "🛁", groceries: "🛒", errands: "🏃", bills: "🧾", other: "📌",
};

const CATEGORY_STYLE: Record<string, { tone: string; d: string }> = {
  cleaning: { tone: "bg-sky-100 text-sky-700", d: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2" },
  kitchen: { tone: "bg-amber-100 text-amber-700", d: "M4 10h16v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM2 10h2M20 10h2M9 6.5c0-1.2 1-1.3 1-2.5M14 6.5c0-1.2 1-1.3 1-2.5" },
  trash: { tone: "bg-emerald-100 text-emerald-700", d: "M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6" },
  laundry: { tone: "bg-violet-100 text-violet-700", d: "M8 4 3 7l2 4 3-1v10h8V10l3 1 2-4-5-3a4 4 0 0 1-8 0z" },
  bathroom: { tone: "bg-cyan-100 text-cyan-700", d: "M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" },
  groceries: { tone: "bg-peach-100 text-peach-700", d: "M5 7h14l-1.5 9h-11zM9 7V5a3 3 0 0 1 6 0v2" },
  errands: { tone: "bg-rose-100 text-rose-700", d: "M5 12h14M13 6l6 6-6 6" },
  bills: { tone: "bg-brand-100 text-ink", d: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" },
  other: { tone: "bg-slate-100 text-slate-600", d: "M12 8v8M8 12h8" },
};

/** A small colored tile per chore category, so lists are scannable at a glance. */
export function CategoryIcon({ category, className = "h-10 w-10" }: { category: string; className?: string }) {
  const c = CATEGORY_STYLE[category] ?? CATEGORY_STYLE.other!;
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-xl ${c.tone} ${className}`} aria-hidden>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d={c.d} /></svg>
    </span>
  );
}

export function TaskRow({ occ, members, tz, currentUserId, alsoMissed = 0 }: { occ: OccWithDef; members: Member[]; tz: string; currentUserId: string; alsoMissed?: number }) {
  const assignee = members.find((m) => m.id === occ.assigneeId);
  const overdue = occ.status === "PENDING" && occ.dueAt < new Date();
  const done = occ.status === "DONE";
  return (
    <li className="relative flex items-center gap-3 py-3 pl-4 pr-4">
      {occ.status === "PENDING" && (
        <span aria-hidden className={`absolute inset-y-2 left-0 w-1 rounded-r-full ${overdue ? "bg-peach-400" : occ.dueAt.getTime() - Date.now() < 24 * 3600e3 ? "bg-amber-400" : "bg-emerald-400"}`} />
      )}
      {occ.status === "PENDING" ? (
        <form action={completeAction}>
          <input type="hidden" name="occurrenceId" value={occ.id} />
          <button aria-label={`Mark “${occ.definition.title}” done`}
            className="flex h-8 w-8 items-center justify-center rounded-[10px] border-2 border-ink bg-white text-transparent transition hover:bg-peach-50 hover:text-peach-400 active:scale-95">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden><path d="m5 12 5 5 9-10" /></svg>
          </button>
        </form>
      ) : (
        <form action={reopenAction}>
          <input type="hidden" name="occurrenceId" value={occ.id} />
          <button aria-label={`Undo “${occ.definition.title}”`} title="Undo"
            className={`flex h-8 w-8 items-center justify-center rounded-[10px] ${done ? "bg-peach-400 text-white" : "bg-slate-200 text-slate-600"}`}>
            {done ? <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden><path d="m5 12 5 5 9-10" /></svg> : "–"}
          </button>
        </form>
      )}
      <CategoryIcon category={occ.definition.category} />
      <Link href={`/tasks/${occ.definitionId}`} className="min-w-0 flex-1">
        <p className={`truncate text-[15px] font-bold ${occ.status !== "PENDING" ? "text-slate-400 line-through" : ""}`}>
          {occ.definition.title}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
          <span className={overdue ? "font-bold text-peach-500" : ""}>{overdue ? "Was due " : ""}{formatDue(occ.dueAt, tz)}</span>
          <span>~{occ.definition.estimatedMinutes} min</span>
          {occ.status === "SKIPPED" && <Badge>Skipped</Badge>}
          {occ.definition.recurrence !== "NONE" && <span aria-label="Repeats">↻</span>}
          {alsoMissed > 0 && <Badge tone="red">+{alsoMissed} earlier missed</Badge>}
          {occ.definition.kind === "ERRAND" && <Badge tone="violet">Errand</Badge>}
        </p>
      </Link>
      {assignee ? (
        <Avatar id={assignee.id} name={assignee.name} size="sm" />
      ) : occ.status === "PENDING" ? (
        <form action={claimAction}>
          <input type="hidden" name="occurrenceId" value={occ.id} />
          <button className="btn-peach min-h-8 whitespace-nowrap rounded-full px-3.5 py-1 text-xs">I'll do it</button>
        </form>
      ) : null}
      {done && occ.completedById && occ.completedById !== occ.assigneeId && (
        <span className="sr-only">Completed by {members.find((m) => m.id === occ.completedById)?.name}</span>
      )}
      {void currentUserId}
    </li>
  );
}

/**
 * `collapseRepeats` shows one row per recurring chore (the most recent missed one)
 * instead of a wall of identical overdue rows, with a count of the earlier ones.
 */
export function TaskList({ items, members, tz, currentUserId, collapseRepeats = false }: { items: OccWithDef[]; members: Member[]; tz: string; currentUserId: string; collapseRepeats?: boolean }) {
  const rows: { occ: OccWithDef; alsoMissed: number }[] = [];
  if (collapseRepeats) {
    const byKey = new Map<string, { occ: OccWithDef; alsoMissed: number }>();
    for (const o of items) {
      const key = `${o.definitionId}:${o.assigneeId ?? ""}`;
      const seen = byKey.get(key);
      if (!seen) { const r = { occ: o, alsoMissed: 0 }; byKey.set(key, r); rows.push(r); }
      else { seen.alsoMissed++; if (o.dueAt > seen.occ.dueAt) seen.occ = o; }
    }
  } else rows.push(...items.map((occ) => ({ occ, alsoMissed: 0 })));
  return (
    <ul className="card divide-y divide-slate-200 overflow-hidden">
      {rows.map(({ occ, alsoMissed }) => <TaskRow key={occ.id} occ={occ} members={members} tz={tz} currentUserId={currentUserId} alsoMissed={alsoMissed} />)}
    </ul>
  );
}
