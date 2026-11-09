import { DateTime } from "luxon";
import { z } from "zod";
import type { Prisma, TaskDefinition } from "@prisma/client";
import { prisma } from "./db";
import { assertAllMembers, requireMember } from "./access";
import { invalid, notFound } from "./errors";
import { generateSlots } from "@/lib/recurrence";
import { notify } from "./notifications";

export const TASK_CATEGORIES = ["cleaning", "kitchen", "trash", "laundry", "bathroom", "groceries", "errands", "bills", "other"] as const;

/** How far ahead recurring occurrences are materialized. */
export const HORIZON_DAYS = 21;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export const taskInputSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(120),
    description: z.string().trim().max(2000).optional().nullable().transform((v) => v || null),
    kind: z.enum(["CHORE", "ERRAND"]).default("CHORE"),
    category: z.string().trim().min(1).max(40).default("cleaning"),
    estimatedMinutes: z.coerce.number().int().min(1, "Estimate at least 1 minute").max(24 * 60).default(15),
    recurrence: z.enum(["NONE", "DAILY", "WEEKLY"]).default("NONE"),
    interval: z.coerce.number().int().min(1).max(52).default(1),
    weekdays: z.array(z.coerce.number().int().min(1).max(7)).default([]),
    startsOn: dateStr,
    endsOn: dateStr.optional().nullable().transform((v) => v || null),
    dueTime: timeStr.default("20:00"),
    assignmentMode: z.enum(["UNASSIGNED", "FIXED", "ROTATE"]).default("UNASSIGNED"),
    assigneeId: z.string().optional().nullable().transform((v) => v || null),
    eligibleUserIds: z.array(z.string()).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.assignmentMode === "FIXED" && !v.assigneeId)
      ctx.addIssue({ code: "custom", path: ["assigneeId"], message: "Choose who this is assigned to" });
    if (v.assignmentMode === "ROTATE" && v.eligibleUserIds.length < 2)
      ctx.addIssue({ code: "custom", path: ["eligibleUserIds"], message: "Pick at least two roommates to rotate between" });
    if (v.recurrence === "WEEKLY" && v.weekdays.length === 0)
      ctx.addIssue({ code: "custom", path: ["weekdays"], message: "Pick at least one day of the week" });
    if (v.endsOn && v.endsOn < v.startsOn)
      ctx.addIssue({ code: "custom", path: ["endsOn"], message: "End date must be after the start date" });
  });

export type TaskInput = z.input<typeof taskInputSchema>;

function assigneeForSequence(def: Pick<TaskDefinition, "assignmentMode" | "assigneeId" | "eligibleUserIds">, sequence: number) {
  if (def.assignmentMode === "FIXED") return def.assigneeId;
  if (def.assignmentMode === "ROTATE" && def.eligibleUserIds.length > 0)
    return def.eligibleUserIds[sequence % def.eligibleUserIds.length];
  return null;
}

/**
 * Make sure every slot from the rule up to the horizon exists as a TaskOccurrence row.
 * Idempotent: the (definitionId, originalDueAt) unique key + skipDuplicates means it can
 * run from page loads, the worker, and tests concurrently without creating duplicates.
 */
export async function ensureOccurrences(householdId: string, now = new Date()) {
  const household = await prisma.household.findUniqueOrThrow({ where: { id: householdId } });
  const defs = await prisma.taskDefinition.findMany({
    where: { householdId, archivedAt: null },
    include: { _count: { select: { occurrences: true } } },
  });
  const tz = household.timezone;
  const horizon = DateTime.fromJSDate(now).setZone(tz).plus({ days: HORIZON_DAYS }).toISODate()!;
  const rows: Prisma.TaskOccurrenceCreateManyInput[] = [];
  for (const def of defs) {
    // A one-time task has exactly one occurrence, ever.
    if (def.recurrence === "NONE" && def._count.occurrences > 0) continue;
    // Never backfill slots from before the task was created (except one-time tasks, which always get their one slot).
    const created = DateTime.fromJSDate(def.createdAt).setZone(tz).toISODate()!;
    const from = def.recurrence === "NONE" ? def.startsOn : created > def.startsOn ? created : def.startsOn;
    const to = def.recurrence === "NONE" && def.startsOn > horizon ? def.startsOn : horizon;
    for (const slot of generateSlots(def, tz, from, to)) {
      rows.push({
        definitionId: def.id,
        householdId,
        sequence: slot.sequence,
        originalDueAt: slot.dueAt,
        dueAt: slot.dueAt,
        assigneeId: assigneeForSequence(def, slot.sequence),
      });
    }
  }
  if (rows.length) await prisma.taskOccurrence.createMany({ data: rows, skipDuplicates: true });
}

async function validateAssignees(householdId: string, data: z.output<typeof taskInputSchema>) {
  const ids = [...data.eligibleUserIds, ...(data.assigneeId ? [data.assigneeId] : [])];
  await assertAllMembers(householdId, ids);
}

export async function createTask(userId: string, householdId: string, input: unknown) {
  await requireMember(userId, householdId);
  const data = taskInputSchema.parse(input);
  await validateAssignees(householdId, data);
  const def = await prisma.taskDefinition.create({
    data: {
      ...data,
      eligibleUserIds: data.assignmentMode === "ROTATE" ? data.eligibleUserIds : data.eligibleUserIds,
      assigneeId: data.assignmentMode === "FIXED" ? data.assigneeId : null,
      householdId,
      createdById: userId,
    },
  });
  await ensureOccurrences(householdId);
  if (def.assignmentMode === "FIXED" && def.assigneeId && def.assigneeId !== userId) {
    await notify({
      userId: def.assigneeId,
      householdId,
      type: "task_assigned",
      title: `You were assigned “${def.title}”`,
      link: `/tasks/${def.id}`,
      dedupeKey: `task_assigned:${def.id}:${def.assigneeId}`,
    });
  }
  return def;
}

async function loadDefinition(userId: string, taskId: string) {
  const def = await prisma.taskDefinition.findUnique({ where: { id: taskId } });
  if (!def) throw notFound("Task");
  await requireMember(userId, def.householdId);
  return def;
}

/**
 * Edit a task's rule. Completed/skipped history and occurrences someone changed by
 * hand are preserved; untouched future occurrences are regenerated from the new rule.
 */
export async function updateTask(userId: string, taskId: string, input: unknown) {
  const def = await loadDefinition(userId, taskId);
  const data = taskInputSchema.parse(input);
  await validateAssignees(def.householdId, data);
  const now = new Date();
  const assigneeId = data.assignmentMode === "FIXED" ? data.assigneeId : null;
  const updated = await prisma.taskDefinition.update({ where: { id: taskId }, data: { ...data, assigneeId } });
  const tz = (await prisma.household.findUniqueOrThrow({ where: { id: def.householdId } })).timezone;

  if (data.recurrence === "NONE") {
    // Editing a one-time task edits its single occurrence (if it hasn't been done yet).
    const occs = await prisma.taskOccurrence.findMany({ where: { definitionId: taskId } });
    const pending = occs.find((o) => o.status === "PENDING");
    if (pending) {
      const [slot] = generateSlots(updated, tz, data.startsOn, data.startsOn);
      await prisma.taskOccurrence.update({
        where: { id: pending.id },
        data: { originalDueAt: slot.dueAt, dueAt: slot.dueAt, assigneeId: assigneeForSequence(updated, 0) },
      });
    }
    if (!pending && def.recurrence !== "NONE") {
      // Switching from recurring to one-time: create the single new occurrence explicitly
      // (ensureOccurrences skips one-time tasks that already have history rows).
      const [slot] = generateSlots(updated, tz, data.startsOn, data.startsOn);
      const maxSeq = occs.reduce((m, o) => Math.max(m, o.sequence), -1);
      await prisma.taskOccurrence.createMany({
        data: [{ definitionId: taskId, householdId: def.householdId, sequence: maxSeq + 1, originalDueAt: slot.dueAt, dueAt: slot.dueAt, assigneeId: assigneeForSequence(updated, 0) }],
        skipDuplicates: true,
      });
    }
    // Drop untouched future occurrences from the old recurring rule, keep history.
    await prisma.taskOccurrence.deleteMany({
      where: { definitionId: taskId, status: "PENDING", manuallyChanged: false, dueAt: { gte: now }, ...(pending ? { id: { not: pending.id } } : {}), originalDueAt: { not: generateSlots(updated, tz, data.startsOn, data.startsOn)[0].dueAt } },
    });
  } else {
    await prisma.taskOccurrence.deleteMany({
      where: { definitionId: taskId, status: "PENDING", manuallyChanged: false, dueAt: { gte: now } },
    });
  }
  await ensureOccurrences(def.householdId);
  return prisma.taskDefinition.findUniqueOrThrow({ where: { id: taskId } });
}

/** Stop a task from generating new occurrences. History is kept. */
export async function archiveTask(userId: string, taskId: string) {
  const def = await loadDefinition(userId, taskId);
  await prisma.$transaction([
    prisma.taskDefinition.update({ where: { id: def.id }, data: { archivedAt: new Date() } }),
    prisma.taskOccurrence.deleteMany({ where: { definitionId: def.id, status: "PENDING", dueAt: { gte: new Date() } } }),
  ]);
}

export async function getTask(userId: string, taskId: string) {
  const def = await loadDefinition(userId, taskId);
  const occurrences = await prisma.taskOccurrence.findMany({
    where: { definitionId: taskId },
    orderBy: { dueAt: "desc" },
    take: 60,
    include: { events: { orderBy: { createdAt: "asc" } } },
  });
  return { def, occurrences };
}

export async function listTaskDefinitions(userId: string, householdId: string) {
  await requireMember(userId, householdId);
  return prisma.taskDefinition.findMany({
    where: { householdId, archivedAt: null },
    orderBy: { createdAt: "asc" },
  });
}

export type OccurrenceFilter = {
  from?: Date;
  to?: Date;
  assigneeId?: string | "unassigned";
  status?: "PENDING" | "DONE" | "SKIPPED";
  category?: string;
  take?: number;
};

export async function listOccurrences(userId: string, householdId: string, f: OccurrenceFilter = {}) {
  await requireMember(userId, householdId);
  await ensureOccurrences(householdId);
  return prisma.taskOccurrence.findMany({
    where: {
      householdId,
      dueAt: { gte: f.from, lt: f.to },
      status: f.status,
      assigneeId: f.assigneeId === "unassigned" ? null : f.assigneeId,
      definition: f.category ? { category: f.category } : undefined,
    },
    include: { definition: true },
    orderBy: { dueAt: f.status === "DONE" ? "desc" : "asc" },
    take: f.take ?? 200,
  });
}

// ---- Occurrence actions ----

async function loadOccurrence(userId: string, occurrenceId: string) {
  const occ = await prisma.taskOccurrence.findUnique({ where: { id: occurrenceId }, include: { definition: true } });
  if (!occ) throw notFound("Task");
  await requireMember(userId, occ.householdId);
  return occ;
}

export async function completeOccurrence(userId: string, occurrenceId: string) {
  const occ = await loadOccurrence(userId, occurrenceId);
  if (occ.status === "DONE") return occ;
  // Conditional update guards against two roommates tapping "done" at the same time.
  const res = await prisma.taskOccurrence.updateMany({
    where: { id: occ.id, status: { not: "DONE" } },
    data: { status: "DONE", completedAt: new Date(), completedById: userId, skipReason: null },
  });
  if (res.count === 1) {
    await prisma.taskEvent.create({
      data: { occurrenceId: occ.id, actorId: userId, type: "completed", data: { forAssignee: occ.assigneeId } },
    });
  }
  return prisma.taskOccurrence.findUniqueOrThrow({ where: { id: occ.id } });
}

export async function skipOccurrence(userId: string, occurrenceId: string, reason?: string) {
  const occ = await loadOccurrence(userId, occurrenceId);
  if (occ.status !== "PENDING") throw invalid("Only pending tasks can be skipped");
  const clean = reason?.trim().slice(0, 200) || null;
  await prisma.$transaction([
    prisma.taskOccurrence.update({ where: { id: occ.id }, data: { status: "SKIPPED", skipReason: clean, manuallyChanged: true } }),
    prisma.taskEvent.create({ data: { occurrenceId: occ.id, actorId: userId, type: "skipped", data: { reason: clean } } }),
  ]);
  return prisma.taskOccurrence.findUniqueOrThrow({ where: { id: occ.id } });
}

export async function reopenOccurrence(userId: string, occurrenceId: string) {
  const occ = await loadOccurrence(userId, occurrenceId);
  if (occ.status === "PENDING") return occ;
  await prisma.$transaction([
    prisma.taskOccurrence.update({
      where: { id: occ.id },
      data: { status: "PENDING", completedAt: null, completedById: null, skipReason: null, manuallyChanged: true },
    }),
    prisma.taskEvent.create({ data: { occurrenceId: occ.id, actorId: userId, type: "reopened", data: { from: occ.status } } }),
  ]);
  return prisma.taskOccurrence.findUniqueOrThrow({ where: { id: occ.id } });
}

export async function assignOccurrence(userId: string, occurrenceId: string, assigneeId: string | null) {
  const occ = await loadOccurrence(userId, occurrenceId);
  if (assigneeId) await assertAllMembers(occ.householdId, [assigneeId]);
  if (occ.assigneeId === assigneeId) return occ;
  await prisma.$transaction([
    prisma.taskOccurrence.update({ where: { id: occ.id }, data: { assigneeId, manuallyChanged: true } }),
    prisma.taskEvent.create({
      data: { occurrenceId: occ.id, actorId: userId, type: "assigned", data: { from: occ.assigneeId, to: assigneeId } },
    }),
  ]);
  if (assigneeId && assigneeId !== userId) {
    await notify({
      userId: assigneeId,
      householdId: occ.householdId,
      type: "task_assigned",
      title: `You were assigned “${occ.definition.title}”`,
      link: `/tasks/${occ.definitionId}`,
      dedupeKey: `occ_assigned:${occ.id}:${assigneeId}:${Date.now()}`,
    });
  }
  return prisma.taskOccurrence.findUniqueOrThrow({ where: { id: occ.id } });
}

export async function rescheduleOccurrence(userId: string, occurrenceId: string, newDueAt: Date) {
  const occ = await loadOccurrence(userId, occurrenceId);
  if (occ.status !== "PENDING") throw invalid("Only pending tasks can be rescheduled");
  if (Number.isNaN(newDueAt.getTime())) throw invalid("Pick a valid date and time");
  await prisma.$transaction([
    prisma.taskOccurrence.update({
      where: { id: occ.id },
      // Moving the due date invalidates any planned slot; the person can re-plan it.
      data: { dueAt: newDueAt, manuallyChanged: true, scheduledStart: null, scheduledEnd: null },
    }),
    prisma.taskEvent.create({
      data: { occurrenceId: occ.id, actorId: userId, type: "rescheduled", data: { from: occ.dueAt.toISOString(), to: newDueAt.toISOString() } },
    }),
  ]);
  return prisma.taskOccurrence.findUniqueOrThrow({ where: { id: occ.id } });
}

/** One-tap "add a quick chore" used by onboarding and the home screen. */
export async function quickAddTask(
  userId: string,
  householdId: string,
  input: { title: string; dueDate?: string; assigneeId?: string | null; category?: string; estimatedMinutes?: number },
) {
  const m = await requireMember(userId, householdId);
  const today = DateTime.now().setZone(m.household.timezone).toISODate()!;
  return createTask(userId, householdId, {
    title: input.title,
    category: input.category ?? "cleaning",
    estimatedMinutes: input.estimatedMinutes ?? 15,
    startsOn: input.dueDate || today,
    dueTime: "20:00",
    recurrence: "NONE",
    assignmentMode: input.assigneeId ? "FIXED" : "UNASSIGNED",
    assigneeId: input.assigneeId ?? null,
  });
}

// ---- Nudges ----

/**
 * Gently remind the assignee of an overdue chore. At most one nudge per chore per
 * household-local day, whoever sends it, so nobody gets piled on.
 * Returns `sent: false` when someone already nudged today.
 */
export async function nudgeOccurrence(userId: string, occurrenceId: string, now = new Date()) {
  const occ = await loadOccurrence(userId, occurrenceId);
  if (occ.status !== "PENDING") throw invalid("That task isn't open any more");
  if (!occ.assigneeId) throw invalid("Nobody is assigned yet. Claim it or assign someone instead.");
  if (occ.assigneeId === userId) throw invalid("That one's yours");
  if (occ.dueAt > now) throw invalid("You can only nudge once it's overdue");
  const [household, sender, assignee] = await Promise.all([
    prisma.household.findUniqueOrThrow({ where: { id: occ.householdId }, select: { timezone: true } }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } }),
    prisma.membership.findFirst({ where: { householdId: occ.householdId, userId: occ.assigneeId, leftAt: null }, include: { user: { select: { name: true } } } }),
  ]);
  if (!assignee) throw invalid("That person isn't in the household any more");
  const day = DateTime.fromJSDate(now).setZone(household.timezone).toISODate()!;
  const dedupeKey = `nudge:${occ.id}:${day}`;
  if (await prisma.notification.findUnique({ where: { dedupeKey } })) return { sent: false, assigneeName: assignee.user.name };
  const n = await notify({
    userId: occ.assigneeId, householdId: occ.householdId, type: "task_nudge",
    title: `${sender.name.split(" ")[0]} nudged you: ${occ.definition.title}`,
    body: `It was due ${DateTime.fromJSDate(occ.dueAt).setZone(household.timezone).toFormat("ccc h:mm a")}. Mark it done, or pick a new time if today doesn't work.`,
    link: `/tasks/${occ.definitionId}`, dedupeKey,
  });
  if (!n) return { sent: false, assigneeName: assignee.user.name }; // lost a race with another nudge
  await prisma.taskEvent.create({ data: { occurrenceId: occ.id, actorId: userId, type: "nudged" } });
  return { sent: true, assigneeName: assignee.user.name };
}
