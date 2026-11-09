"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  archiveTask, assignOccurrence, completeOccurrence, createTask, reopenOccurrence,
  rescheduleOccurrence, skipOccurrence, updateTask, quickAddTask, nudgeOccurrence,
} from "@/server/tasks";
import { requireHousehold, requireUser } from "@/server/session";
import { toActionError, type ActionState } from "@/server/action";
import { localToUtc } from "@/lib/time";

function taskFromForm(fd: FormData) {
  return {
    title: fd.get("title"),
    description: fd.get("description"),
    kind: fd.get("kind") || "CHORE",
    category: fd.get("category") || "cleaning",
    estimatedMinutes: fd.get("estimatedMinutes") || 15,
    recurrence: fd.get("recurrence") || "NONE",
    interval: fd.get("interval") || 1,
    weekdays: fd.getAll("weekdays").map(Number),
    startsOn: fd.get("startsOn"),
    endsOn: fd.get("endsOn"),
    dueTime: fd.get("dueTime") || "20:00",
    assignmentMode: fd.get("assignmentMode") || "UNASSIGNED",
    assigneeId: fd.get("assigneeId"),
    eligibleUserIds: fd.getAll("eligibleUserIds").map(String),
  };
}

function refresh() {
  revalidatePath("/home");
  revalidatePath("/tasks", "layout");
  revalidatePath("/planner");
}

export async function createTaskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const { user, household } = await requireHousehold();
    id = (await createTask(user.id, household.id, taskFromForm(fd))).id;
  } catch (e) {
    return toActionError(e);
  }
  refresh();
  redirect(`/tasks/${id}`);
}

export async function updateTaskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("id"));
  try {
    const user = await requireUser();
    await updateTask(user.id, id, taskFromForm(fd));
  } catch (e) {
    return toActionError(e);
  }
  refresh();
  redirect(`/tasks/${id}`);
}

export async function quickAddTaskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { user, household } = await requireHousehold();
    const title = String(fd.get("title") ?? "").trim();
    await quickAddTask(user.id, household.id, {
      title,
      assigneeId: fd.get("mine") === "on" ? user.id : null,
    });
    refresh();
    return { ok: true, message: `Added “${title}” for today` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function archiveTaskAction(fd: FormData) {
  const user = await requireUser();
  await archiveTask(user.id, String(fd.get("id")));
  refresh();
  redirect("/tasks?view=all");
}

export async function completeAction(fd: FormData) {
  const user = await requireUser();
  await completeOccurrence(user.id, String(fd.get("occurrenceId")));
  refresh();
}

export async function reopenAction(fd: FormData) {
  const user = await requireUser();
  await reopenOccurrence(user.id, String(fd.get("occurrenceId")));
  refresh();
}

export async function skipAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    await skipOccurrence(user.id, String(fd.get("occurrenceId")), String(fd.get("reason") ?? ""));
    refresh();
    return { ok: true, message: "Skipped" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function assignAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const to = String(fd.get("assigneeId") ?? "");
    await assignOccurrence(user.id, String(fd.get("occurrenceId")), to || null);
    refresh();
    return { ok: true, message: "Assignment updated" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function claimAction(fd: FormData) {
  const user = await requireUser();
  await assignOccurrence(user.id, String(fd.get("occurrenceId")), user.id);
  refresh();
}

export async function rescheduleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { user, household } = await requireHousehold();
    const due = localToUtc(String(fd.get("date")), String(fd.get("time") || "20:00"), household.timezone);
    await rescheduleOccurrence(user.id, String(fd.get("occurrenceId")), due);
    refresh();
    return { ok: true, message: "Rescheduled" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function nudgeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const r = await nudgeOccurrence(user.id, String(fd.get("occurrenceId")));
    const first = r.assigneeName.split(" ")[0];
    return { ok: true, message: r.sent ? `Nudged ${first}` : `${first} was already nudged today` };
  } catch (e) {
    return toActionError(e);
  }
}
