import { DateTime } from "luxon";
import { requireHousehold } from "@/server/session";
import { activeMembers } from "@/server/access";
import { TaskForm } from "@/components/task-form";
import { createTaskAction } from "@/app/actions/tasks";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "New task" };

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { household } = await requireHousehold();
  const members = await activeMembers(household.id);
  const { kind } = await searchParams;
  return (
    <>
      <PageHeader title="New task" subtitle="Chores repeat; errands are usually one-offs." />
      <div className="card p-5">
        <TaskForm
          action={createTaskAction}
          members={members}
          submitLabel="Create task"
          initial={{
            title: "", description: "", kind: kind === "ERRAND" ? "ERRAND" : "CHORE", category: kind === "ERRAND" ? "errands" : "cleaning",
            estimatedMinutes: 15, recurrence: "NONE", interval: 1, weekdays: [], startsOn: DateTime.now().setZone(household.timezone).toISODate()!,
            endsOn: "", dueTime: "20:00", assignmentMode: "UNASSIGNED", assigneeId: "", eligibleUserIds: [],
          }}
        />
      </div>
    </>
  );
}
