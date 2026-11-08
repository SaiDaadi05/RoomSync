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

export function TaskRow({ occ, members, tz, currentUserId, alsoMissed = 0 }: { occ: OccWithDef; members: Member[]; tz: string; currentUserId: string; alsoMissed?: number }) {
  const assignee = members.find((m) => m.id === occ.assigneeId);
  const overdue = occ.status === "PENDING" && occ.dueAt < new Date();
  const done = occ.status === "DONE";
  return (
    <li className="flex items-center gap-3 px-4 py-3.5">
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
      <Link href={`/tasks/${occ.definitionId}`} className="min-w-0 flex-1">
        <p className={`truncate text-[15px] font-bold ${occ.status !== "PENDING" ? "text-slate-400 line-through" : ""}`}>
          {occ.definition.title}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
          <span className={overdue ? "font-bold text-peach-500" : ""}>{overdue ? "Was due " : ""}{formatDue(occ.dueAt, tz)}</span>
          <span className="capitalize">{occ.definition.category}</span>
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
