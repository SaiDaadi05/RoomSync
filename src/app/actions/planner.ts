"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireHousehold, requireUser } from "@/server/session";
import { toActionError, type ActionState } from "@/server/action";
import { acceptSchedule, addAvailability, deleteAvailability, swapOccurrences, syncOccurrenceToGoogle, unscheduleOccurrence } from "@/server/planner";
import { revokeGoogle } from "@/server/calendar/google";
import { hhmmToMinutes, localToUtc } from "@/lib/time";
import { prisma } from "@/server/db";
import { invalid } from "@/server/errors";

function refresh() {
  revalidatePath("/planner", "layout");
  revalidatePath("/home");
  revalidatePath("/tasks", "layout");
}

export async function acceptProposalsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { user, household } = await requireHousehold();
    const items = fd.getAll("proposal").map((v) => JSON.parse(String(v)));
    const results = await acceptSchedule(user.id, household.id, items);
    refresh();
    const failed = results.filter((r) => !r.ok);
    if (failed.length) return { error: `${results.length - failed.length} planned, ${failed.length} couldn't be: ${failed.map((f) => f.error).join("; ")}` };
    return { ok: true, message: `Planned ${results.length} task${results.length === 1 ? "" : "s"}` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function planManuallyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { user, household } = await requireHousehold();
    const occ = await prisma.taskOccurrence.findUnique({ where: { id: String(fd.get("occurrenceId")) }, include: { definition: true } });
    if (!occ || occ.householdId !== household.id) throw invalid("Task not found");
    const start = localToUtc(String(fd.get("date")), String(fd.get("time")), user.timezone);
    const end = new Date(start.getTime() + occ.definition.estimatedMinutes * 60_000);
    const [r] = await acceptSchedule(user.id, household.id, [{ occurrenceId: occ.id, assigneeId: occ.assigneeId ?? user.id, start, end }]);
    if (!r.ok) return { error: r.error };
    refresh();
    return { ok: true, message: "Planned" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function unscheduleAction(fd: FormData) {
  const user = await requireUser();
  await unscheduleOccurrence(user.id, String(fd.get("occurrenceId")));
  refresh();
}

export async function syncToGoogleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    await syncOccurrenceToGoogle(user.id, String(fd.get("occurrenceId")));
    refresh();
    return { ok: true, message: "Added to your Google Calendar" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function swapAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    await swapOccurrences(user.id, String(fd.get("mine")), String(fd.get("theirs")));
    refresh();
    return { ok: true, message: "Swapped. Your roommate has been notified." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function addAvailabilityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const days = fd.getAll("weekday").map(Number);
    if (!days.length) throw invalid("Pick at least one day");
    const startMin = hhmmToMinutes(String(fd.get("start")));
    const endMin = hhmmToMinutes(String(fd.get("end")));
    for (const weekday of days) await addAvailability(user.id, { weekday, startMin, endMin });
    revalidatePath("/planner", "layout");
    return { ok: true, message: "Availability added" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteAvailabilityAction(fd: FormData) {
  const user = await requireUser();
  await deleteAvailability(user.id, String(fd.get("id")));
  revalidatePath("/planner", "layout");
}

export async function disconnectCalendarAction(fd: FormData) {
  const user = await requireUser();
  if (fd.get("provider") === "GOOGLE") await revokeGoogle(user.id);
  redirect("/household");
}
