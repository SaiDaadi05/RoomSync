import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { requireHousehold } from "@/server/session";
import { getTask } from "@/server/tasks";
import { activeMembers } from "@/server/access";
import { describeRule } from "@/lib/recurrence";
import { formatDue } from "@/lib/time";
import { Avatar, Badge, Section } from "@/components/ui";
import { OccurrenceActions } from "@/components/occurrence-actions";
import { archiveTaskAction, completeAction, reopenAction } from "@/app/actions/tasks";
import { CATEGORY_EMOJI } from "@/components/task-row";
import { AppError } from "@/server/errors";

export default async function TaskDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, household } = await requireHousehold();
  let data;
  try {
    data = await getTask(user.id, id);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const { def, occurrences } = data;
  const tz = household.timezone;
  const members = await activeMembers(def.householdId);
  const nameOf = (uid: string | null | undefined) => (uid ? members.find((m) => m.id === uid)?.name ?? "Former roommate" : "Anyone");
  const now = new Date();
  const upcoming = occurrences.filter((o) => o.status === "PENDING").sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime()).slice(0, 6);
  const history = occurrences.filter((o) => o.status !== "PENDING");
  // Go back to the tab this chore actually shows up on, so a new "up for grabs" chore isn't missing from "Mine".
  const next = upcoming[0];
  const backView = !next ? "all" : next.assigneeId === user.id ? "mine" : !next.assigneeId ? "open" : "all";
  const assignmentText =
    def.assignmentMode === "FIXED" ? `Always ${nameOf(def.assigneeId)}`
      : def.assignmentMode === "ROTATE" ? `Takes turns: ${def.eligibleUserIds.map(nameOf).join(" → ")}`
        : "Anyone can pick it up";

  return (
    <>
      <Link href={`/tasks?view=${backView}`} className="mb-3 inline-block text-sm font-medium text-brand-700">← Chores</Link>
      <div className="card mb-5 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold"><span aria-hidden>{CATEGORY_EMOJI[def.category] ?? "📌"} </span>{def.title}</h1>
            <p className="mt-1 flex flex-wrap gap-1.5">
              <Badge tone={def.kind === "ERRAND" ? "violet" : "blue"}>{def.kind === "ERRAND" ? "Errand" : "Chore"}</Badge>
              <Badge>{describeRule(def)}</Badge>
              <Badge>~{def.estimatedMinutes} min</Badge>
              {def.archivedAt && <Badge tone="amber">Archived</Badge>}
            </p>
          </div>
          {!def.archivedAt && <Link href={`/tasks/${def.id}/edit`} className="btn-secondary">Edit</Link>}
        </div>
        <p className="mt-3 text-sm text-muted">{assignmentText} · due by {DateTime.fromFormat(def.dueTime, "HH:mm").toFormat("h:mm a")}</p>
        {def.description && <p className="mt-3 whitespace-pre-wrap text-sm">{def.description}</p>}
      </div>

      <Section title="Coming up">
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted">Nothing scheduled.</p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((o) => {
              const local = DateTime.fromJSDate(o.dueAt).setZone(tz);
              return (
                <li key={o.id} className="card p-3">
                  <div className="flex items-center gap-3">
                    <form action={completeAction}>
                      <input type="hidden" name="occurrenceId" value={o.id} />
                      <button className="btn-secondary min-h-9 px-3 text-xs" aria-label={`Mark ${local.toFormat("ccc LLL d")} done`}>✓ Done</button>
                    </form>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium ${o.dueAt < now ? "text-red-700" : ""}`}>{o.dueAt < now ? "Overdue · " : ""}{formatDue(o.dueAt, tz)}</p>
                      <p className="text-xs text-muted">
                        {nameOf(o.assigneeId)}{o.dueAt.getTime() !== o.originalDueAt.getTime() && " · moved"}
                        {o.scheduledStart && ` · planned ${formatDue(o.scheduledStart, tz)}`}
                      </p>
                    </div>
                    {o.assigneeId && <Avatar id={o.assigneeId} name={nameOf(o.assigneeId)} size="sm" />}
                  </div>
                  <div className="mt-2">
                    <OccurrenceActions occurrenceId={o.id} assigneeId={o.assigneeId} members={members} dueDate={local.toISODate()!} dueTime={local.toFormat("HH:mm")} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="History">
        {history.length === 0 ? (
          <p className="text-sm text-muted">No completed or skipped occurrences yet.</p>
        ) : (
          <ul className="card divide-y divide-slate-100">
            {history.map((o) => (
              <li key={o.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span aria-hidden>{o.status === "DONE" ? "✅" : "⏭️"}</span>
                <div className="flex-1">
                  <p className="font-medium">
                    {o.status === "DONE" ? `Done by ${nameOf(o.completedById)}` : "Skipped"}
                    {o.status === "DONE" && o.assigneeId && o.completedById !== o.assigneeId && <span className="font-normal text-muted"> (covering for {nameOf(o.assigneeId)})</span>}
                  </p>
                  <p className="text-xs text-muted">
                    Due {DateTime.fromJSDate(o.originalDueAt).setZone(tz).toFormat("ccc LLL d")}
                    {o.completedAt && ` · finished ${formatDue(o.completedAt, tz)}`}
                    {o.skipReason && ` · “${o.skipReason}”`}
                  </p>
                </div>
                <form action={reopenAction}>
                  <input type="hidden" name="occurrenceId" value={o.id} />
                  <button className="text-xs font-semibold text-brand-700">Undo</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {!def.archivedAt && (
        <form action={archiveTaskAction} className="mt-8 text-center">
          <input type="hidden" name="id" value={def.id} />
          <button className="btn-danger">Archive task</button>
          <p className="mt-1 text-xs text-muted">Stops future occurrences. History is kept.</p>
        </form>
      )}
    </>
  );
}
