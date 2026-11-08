import Link from "next/link";
import type { TaskDefinition, TaskOccurrence } from "@prisma/client";
import { Avatar, Badge } from "./ui";
import { completeAction, reopenAction, claimAction } from "@/app/actions/tasks";
import { formatDue } from "@/lib/time";
import { NudgeButton } from "./nudge-button";

type Member = { id: string; name: string };
export type OccWithDef = TaskOccurrence & { definition: TaskDefinition };

export const CATEGORY_EMOJI: Record<string, string> = {
  cleaning: "🧽", kitchen: "🍳", trash: "🗑️", laundry: "🧺", bathroom: "🛁", groceries: "🛒", errands: "🏃", bills: "🧾", other: "📌",
};

export function TaskRow({ occ, members, tz, currentUserId }: { occ: OccWithDef; members: Member[]; tz: string; currentUserId: string }) {
  const assignee = members.find((m) => m.id === occ.assigneeId);
  const overdue = occ.status === "PENDING" && occ.dueAt < new Date();
  const done = occ.status === "DONE";
  return (
    <li className="card flex items-center gap-3 p-3">
      {occ.status === "PENDING" ? (
        <form action={completeAction}>
          <input type="hidden" name="occurrenceId" value={occ.id} />
          <button aria-label={`Mark “${occ.definition.title}” done`}
            className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-slate-300 text-transparent transition hover:border-emerald-500 hover:text-emerald-500">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden><path d="m5 12 5 5 9-10" /></svg>
          </button>
        </form>
      ) : (
        <form action={reopenAction}>
          <input type="hidden" name="occurrenceId" value={occ.id} />
          <button aria-label={`Undo “${occ.definition.title}”`} title="Undo"
            className={`flex h-8 w-8 items-center justify-center rounded-full ${done ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-600"}`}>
            {done ? <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden><path d="m5 12 5 5 9-10" /></svg> : "–"}
          </button>
        </form>
      )}
      <Link href={`/tasks/${occ.definitionId}`} className="min-w-0 flex-1">
        <p className={`truncate font-medium ${occ.status !== "PENDING" ? "text-slate-500 line-through" : ""}`}>
          <span aria-hidden className="mr-1">{CATEGORY_EMOJI[occ.definition.category] ?? "📌"}</span>
          {occ.definition.title}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <span className={overdue ? "font-semibold text-red-700" : ""}>{overdue ? "Overdue · " : ""}{formatDue(occ.dueAt, tz)}</span>
          <span>~{occ.definition.estimatedMinutes} min</span>
          {occ.status === "SKIPPED" && <Badge>Skipped</Badge>}
          {occ.definition.recurrence !== "NONE" && <span aria-label="Repeats">↻</span>}
          {occ.definition.kind === "ERRAND" && <Badge tone="violet">Errand</Badge>}
        </p>
      </Link>
      {overdue && assignee && assignee.id !== currentUserId && <NudgeButton occurrenceId={occ.id} name={assignee.name.split(" ")[0]} />}
      {assignee ? (
        <Avatar id={assignee.id} name={assignee.name} size="sm" />
      ) : occ.status === "PENDING" ? (
        <form action={claimAction}>
          <input type="hidden" name="occurrenceId" value={occ.id} />
          <button className="chip border border-dashed border-slate-300 py-1 text-slate-600 hover:border-brand-500 hover:text-brand-700">I'll do it</button>
        </form>
      ) : null}
      {done && occ.completedById && occ.completedById !== occ.assigneeId && (
        <span className="sr-only">Completed by {members.find((m) => m.id === occ.completedById)?.name}</span>
      )}
    </li>
  );
}

export function TaskList({ items, members, tz, currentUserId }: { items: OccWithDef[]; members: Member[]; tz: string; currentUserId: string }) {
  return (
    <ul className="space-y-2">
      {items.map((o) => <TaskRow key={o.id} occ={o} members={members} tz={tz} currentUserId={currentUserId} />)}
    </ul>
  );
}
