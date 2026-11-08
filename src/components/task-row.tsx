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
    <li className={`card flex items-center gap-3 p-3 pr-3.5 ${overdue ? "border-rose-200/80" : ""}`}>
      {occ.status === "PENDING" ? (
        <form action={completeAction}>
          <input type="hidden" name="occurrenceId" value={occ.id} />
          <button aria-label={`Mark “${occ.definition.title}” done`}
            className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-slate-300 bg-white text-transparent transition hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-600 active:scale-95">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden><path d="m5 12 5 5 9-10" /></svg>
          </button>
        </form>
      ) : (
        <form action={reopenAction}>
          <input type="hidden" name="occurrenceId" value={occ.id} />
          <button aria-label={`Undo “${occ.definition.title}”`} title="Undo"
            className={`flex h-10 w-10 items-center justify-center rounded-full ${done ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-600"}`}>
            {done ? <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden><path d="m5 12 5 5 9-10" /></svg> : "–"}
          </button>
        </form>
      )}
      <Link href={`/tasks/${occ.definitionId}`} className="min-w-0 flex-1">
        <p className={`truncate font-semibold ${occ.status !== "PENDING" ? "text-slate-500 line-through" : ""}`}>
          <span aria-hidden className="mr-1">{CATEGORY_EMOJI[occ.definition.category] ?? "📌"}</span>
          {occ.definition.title}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
          <span className={overdue ? "font-semibold text-rose-700" : ""}>{overdue ? "Was due " : ""}{formatDue(occ.dueAt, tz)}</span>
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
          <button className="chip whitespace-nowrap bg-brand-100 px-3 py-1.5 text-brand-700 hover:bg-brand-200">I'll do it</button>
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
    <ul className="space-y-2.5">
      {rows.map(({ occ, alsoMissed }) => <TaskRow key={occ.id} occ={occ} members={members} tz={tz} currentUserId={currentUserId} alsoMissed={alsoMissed} />)}
    </ul>
  );
}
