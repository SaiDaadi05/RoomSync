import { z } from "zod";
import { prisma } from "./db";
import { assertAllMembers, requireMember } from "./access";
import { AppError, forbidden, invalid, notFound } from "./errors";
import { notify } from "./notifications";
import { workloadSummary } from "./planner";
import { suggestRebalance, type FairTask } from "@/lib/fairness";

/**
 * Handoffs move one pending task from one roommate to another, only after the person
 * who didn't ask agrees. Two ways to start one:
 *  - the assignee offers their task to someone ("Can you take this?")
 *  - someone asks to take a task off the assignee ("Want me to take this?")
 * Nobody can move work between two *other* people.
 */

const createSchema = z.object({
  occurrenceId: z.string().min(1),
  /** The roommate who would end up with the task. */
  toUserId: z.string().min(1),
  message: z.string().trim().max(200).optional().transform((v) => v || null),
  source: z.enum(["manual", "rebalance"]).default("manual"),
});

const firstName = (n: string) => n.split(" ")[0];

/** A pending handoff is only actionable while the task is still pending, unchanged, and not yet due. */
function stillValid(h: { fromUserId: string; occurrence: { status: string; assigneeId: string | null; dueAt: Date } }, now = new Date()) {
  return h.occurrence.status === "PENDING" && h.occurrence.assigneeId === h.fromUserId && h.occurrence.dueAt > now;
}

export async function createHandoff(userId: string, input: unknown) {
  const data = createSchema.parse(input);
  const occ = await prisma.taskOccurrence.findUnique({ where: { id: data.occurrenceId }, include: { definition: true } });
  if (!occ) throw notFound("Task");
  await requireMember(userId, occ.householdId);
  if (occ.status !== "PENDING") throw invalid("That task is already done or skipped");
  if (occ.dueAt <= new Date()) throw invalid("That task is already due. Reschedule it first.");
  if (!occ.assigneeId) throw invalid("That task isn't assigned to anyone yet. Just assign it.");

  let fromUserId: string;
  if (occ.assigneeId === userId) {
    if (data.toUserId === userId) throw invalid("Pick a roommate to hand it to");
    fromUserId = userId;
  } else if (data.toUserId === userId) {
    fromUserId = occ.assigneeId;
  } else {
    throw forbidden("You can offer your own tasks or offer to take someone's, but not move tasks between two other people");
  }
  await assertAllMembers(occ.householdId, [fromUserId, data.toUserId]);

  const open = await prisma.handoffRequest.findFirst({ where: { occurrenceId: occ.id, status: "PENDING" } });
  if (open) throw new AppError("There's already a pending request for that task", "CONFLICT");

  const h = await prisma.handoffRequest.create({
    data: {
      householdId: occ.householdId,
      occurrenceId: occ.id,
      fromUserId,
      toUserId: data.toUserId,
      requestedById: userId,
      source: data.source,
      message: data.message,
    },
  });
  const requester = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  const responder = userId === fromUserId ? data.toUserId : fromUserId;
  await notify({
    userId: responder,
    householdId: occ.householdId,
    type: "handoff_requested",
    title: userId === fromUserId
      ? `${firstName(requester.name)} asked if you can take “${occ.definition.title}”`
      : `${firstName(requester.name)} offered to take “${occ.definition.title}” off your plate`,
    body: data.message ?? undefined,
    link: "/planner#handoffs",
    dedupeKey: `handoff:${h.id}:requested`,
  });
  return h;
}

async function loadHandoff(userId: string, id: string) {
  const h = await prisma.handoffRequest.findUnique({ where: { id }, include: { occurrence: { include: { definition: true } } } });
  if (!h) throw notFound("Request");
  await requireMember(userId, h.householdId);
  return h;
}

export async function respondHandoff(userId: string, id: string, accept: boolean) {
  const h = await loadHandoff(userId, id);
  const responder = h.requestedById === h.fromUserId ? h.toUserId : h.fromUserId;
  if (userId !== responder) throw forbidden("Only the roommate this was sent to can answer it");
  if (h.status !== "PENDING") throw invalid("That request was already answered or cancelled");

  if (!accept) {
    await prisma.handoffRequest.update({ where: { id: h.id }, data: { status: "DECLINED", respondedAt: new Date() } });
  } else {
    if (!stillValid(h)) {
      await prisma.handoffRequest.update({ where: { id: h.id }, data: { status: "CANCELLED", respondedAt: new Date() } });
      throw invalid("That task changed since the request was sent, so nothing was moved");
    }
    await assertAllMembers(h.householdId, [h.fromUserId, h.toUserId]);
    await prisma.$transaction(async (tx) => {
      // Guarded update: only moves it if it's still pending and still the giver's.
      const res = await tx.taskOccurrence.updateMany({
        where: { id: h.occurrenceId, status: "PENDING", assigneeId: h.fromUserId },
        // The planned slot came from the old assignee's free time, so clear it.
        data: { assigneeId: h.toUserId, manuallyChanged: true, scheduledStart: null, scheduledEnd: null },
      });
      if (res.count !== 1) throw invalid("That task changed since the request was sent, so nothing was moved");
      await tx.taskEvent.create({
        data: { occurrenceId: h.occurrenceId, actorId: userId, type: "assigned", data: { from: h.fromUserId, to: h.toUserId, via: "handoff", handoffId: h.id, source: h.source } },
      });
      await tx.handoffRequest.update({ where: { id: h.id }, data: { status: "ACCEPTED", respondedAt: new Date() } });
    });
  }

  const me = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  await notify({
    userId: h.requestedById,
    householdId: h.householdId,
    type: accept ? "handoff_accepted" : "handoff_declined",
    title: accept
      ? `${firstName(me.name)} said yes: “${h.occurrence.definition.title}” is now ${h.toUserId === userId ? "theirs" : "yours"}`
      : `${firstName(me.name)} can't swap “${h.occurrence.definition.title}” right now`,
    link: `/tasks/${h.occurrence.definitionId}`,
    dedupeKey: `handoff:${h.id}:${accept ? "accepted" : "declined"}`,
  });
}

export async function cancelHandoff(userId: string, id: string) {
  const h = await loadHandoff(userId, id);
  if (h.requestedById !== userId) throw forbidden("Only the person who asked can cancel it");
  if (h.status !== "PENDING") return;
  await prisma.handoffRequest.update({ where: { id: h.id }, data: { status: "CANCELLED", respondedAt: new Date() } });
}

/** Pending, still-valid requests that involve this user. */
export async function listMyHandoffs(userId: string, householdId: string) {
  await requireMember(userId, householdId);
  const rows = await prisma.handoffRequest.findMany({
    where: { householdId, status: "PENDING", OR: [{ fromUserId: userId }, { toUserId: userId }] },
    include: { occurrence: { include: { definition: { select: { title: true, estimatedMinutes: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const now = new Date();
  return rows.filter((h) => stillValid(h, now)).map((h) => ({
    id: h.id,
    occurrenceId: h.occurrenceId,
    title: h.occurrence.definition.title,
    minutes: h.occurrence.definition.estimatedMinutes,
    dueAt: h.occurrence.dueAt,
    fromUserId: h.fromUserId,
    toUserId: h.toUserId,
    message: h.message,
    source: h.source,
    incoming: h.requestedById !== userId,
  }));
}

/**
 * "Rebalance this week": suggestions only. Each one can be sent as a handoff by the
 * giver or the taker. Rules that pin a task to one person (FIXED) are left alone, and
 * rotation tasks only move within their rotation.
 */
export async function rebalanceSuggestions(userId: string, householdId: string, range: { from: Date; to: Date }) {
  const people = await workloadSummary(userId, householdId, range.from, range.to);
  const now = new Date();
  const [occs, pending] = await Promise.all([
    prisma.taskOccurrence.findMany({
      where: { householdId, status: "PENDING", assigneeId: { not: null }, dueAt: { gte: range.from, lt: range.to, gt: now } },
      include: { definition: { select: { title: true, estimatedMinutes: true, assignmentMode: true, eligibleUserIds: true } } },
    }),
    prisma.handoffRequest.findMany({ where: { householdId, status: "PENDING" }, select: { occurrenceId: true } }),
  ]);
  const busy = new Set(pending.map((p) => p.occurrenceId));
  const tasks: FairTask[] = occs
    .filter((o) => !busy.has(o.id) && o.definition.assignmentMode !== "FIXED")
    .map((o) => ({
      id: o.id,
      title: o.definition.title,
      assigneeId: o.assigneeId!,
      minutes: o.definition.estimatedMinutes,
      eligible: o.definition.eligibleUserIds.length > 0 ? o.definition.eligibleUserIds : null,
    }));
  return suggestRebalance(people, tasks);
}

/** Completed minutes per person for each of the last `weeks` weeks (oldest first). */
export async function fairnessHistory(userId: string, householdId: string, weekStarts: Date[]) {
  await requireMember(userId, householdId);
  if (weekStarts.length === 0) return [];
  const end = new Date(weekStarts[weekStarts.length - 1].getTime() + 7 * 86400_000);
  const done = await prisma.taskOccurrence.findMany({
    where: { householdId, status: "DONE", completedAt: { gte: weekStarts[0], lt: end } },
    select: { completedById: true, completedAt: true, definition: { select: { estimatedMinutes: true } } },
  });
  return weekStarts.map((start, i) => {
    const stop = weekStarts[i + 1] ?? end;
    const minutes = new Map<string, number>();
    for (const d of done) {
      if (!d.completedById || !d.completedAt || d.completedAt < start || d.completedAt >= stop) continue;
      minutes.set(d.completedById, (minutes.get(d.completedById) ?? 0) + d.definition.estimatedMinutes);
    }
    return { start, minutes };
  });
}
