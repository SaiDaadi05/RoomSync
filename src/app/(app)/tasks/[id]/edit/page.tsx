import { requireHousehold } from "@/server/session";
import { activeMembers } from "@/server/access";
import { getTask } from "@/server/tasks";
import { TaskForm } from "@/components/task-form";
import { updateTaskAction } from "@/app/actions/tasks";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Edit task" };

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, household } = await requireHousehold();
  const { def } = await getTask(user.id, id);
  const members = await activeMembers(def.householdId);
  void household;
  return (
    <>
      <PageHeader title="Edit task" subtitle="Changes apply to upcoming occurrences. Past history and anything someone changed by hand are kept." />
      <div className="card p-5">
        <TaskForm
          action={updateTaskAction}
          members={members}
          submitLabel="Save changes"
          initial={{
            id: def.id, title: def.title, description: def.description ?? "", kind: def.kind, category: def.category,
            estimatedMinutes: def.estimatedMinutes, recurrence: def.recurrence, interval: def.interval, weekdays: def.weekdays,
            startsOn: def.startsOn, endsOn: def.endsOn ?? "", dueTime: def.dueTime, assignmentMode: def.assignmentMode,
            assigneeId: def.assigneeId ?? "", eligibleUserIds: def.eligibleUserIds,
          }}
        />
      </div>
    </>
  );
}
