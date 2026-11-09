import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { requireMember, requireOwner } from "./access";
import { invalid, notFound } from "./errors";
import { notify } from "./notifications";

type Tx = Prisma.TransactionClient;

/**
 * When someone leaves (or is removed), their open work goes back to the household
 * instead of silently sitting on an inactive person:
 *  - PENDING occurrences assigned to them become unassigned (and unscheduled). DONE/SKIPPED
 *    history is never touched, so their past completions still count in history.
 *  - FIXED rules pointing at them become UNASSIGNED; ROTATE pools drop them. A rotation left
 *    with one person becomes FIXED to that person; with nobody, UNASSIGNED.
 * Returns how many open occurrences were released so the caller can tell the household.
 */
export async function releaseMemberWork(tx: Tx, householdId: string, memberId: string, actorId: string, reason: "left" | "removed") {
  const open = await tx.taskOccurrence.findMany({
    where: { householdId, assigneeId: memberId, status: "PENDING" },
    select: { id: true },
  });
  if (open.length > 0) {
    await tx.taskOccurrence.updateMany({
      where: { id: { in: open.map((o) => o.id) } },
      data: { assigneeId: null, scheduledStart: null, scheduledEnd: null, manuallyChanged: true },
    });
    await tx.taskEvent.createMany({
      data: open.map((o) => ({
        occurrenceId: o.id,
        actorId,
        type: "assigned",
        data: { from: memberId, to: null, reason: `member_${reason}` },
      })),
    });
  }

  const defs = await tx.taskDefinition.findMany({
    where: { householdId, archivedAt: null, OR: [{ assigneeId: memberId }, { eligibleUserIds: { has: memberId } }] },
  });
  for (const def of defs) {
    const pool = def.eligibleUserIds.filter((id) => id !== memberId);
    let data: Prisma.TaskDefinitionUpdateInput = { eligibleUserIds: pool };
    if (def.assignmentMode === "FIXED" && def.assigneeId === memberId) {
      data = { ...data, assignmentMode: "UNASSIGNED", assigneeId: null };
    } else if (def.assignmentMode === "ROTATE") {
      if (pool.length === 1) data = { ...data, assignmentMode: "FIXED", assigneeId: pool[0] };
      else if (pool.length === 0) data = { ...data, assignmentMode: "UNASSIGNED", assigneeId: null };
    }
    await tx.taskDefinition.update({ where: { id: def.id }, data });
  }
  return { releasedOccurrences: open.length, updatedRules: defs.length };
}

async function loadTargetMembership(householdId: string, memberId: string) {
  const target = await prisma.membership.findUnique({
    where: { householdId_userId: { householdId, userId: memberId } },
    include: { user: { select: { name: true } } },
  });
  if (!target || target.leftAt) throw notFound("Roommate");
  return target;
}

/** Owner removes another roommate. Their history and balances stay; their open tasks are released. */
export async function removeMember(ownerId: string, householdId: string, memberId: string) {
  const owner = await requireOwner(ownerId, householdId);
  if (memberId === ownerId) throw invalid("To leave the household yourself, use “Leave household”");
  const target = await loadTargetMembership(householdId, memberId);

  const result = await prisma.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: target.id }, data: { leftAt: new Date() } });
    // Outstanding invites the removed person created stay valid only if an owner made them;
    // simplest safe rule: revoke unused invites they created.
    await tx.invitation.updateMany({
      where: { householdId, createdById: memberId, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return releaseMemberWork(tx, householdId, memberId, ownerId, "removed");
  });

  const now = Date.now();
  await notify({
    userId: memberId,
    householdId,
    type: "member_removed",
    title: `You were removed from ${owner.household.name}`,
    body: "Your past chores and expenses stay in the household's history.",
    dedupeKey: `member_removed:${householdId}:${memberId}:${now}`,
  });
  if (result.releasedOccurrences > 0) await notifyReleased(householdId, [memberId, ownerId], target.user.name, result.releasedOccurrences, now);
  return result;
}

/** Owner promotes a roommate to owner or makes an owner a regular member. */
export async function setMemberRole(ownerId: string, householdId: string, memberId: string, role: "OWNER" | "MEMBER") {
  const owner = await requireOwner(ownerId, householdId);
  const target = await loadTargetMembership(householdId, memberId);
  if (target.role === role) return target;
  if (role === "MEMBER") {
    const owners = await prisma.membership.count({ where: { householdId, role: "OWNER", leftAt: null } });
    if (owners <= 1) throw invalid("A household needs at least one owner. Make someone else an owner first.");
  }
  const updated = await prisma.membership.update({ where: { id: target.id }, data: { role } });
  if (memberId !== ownerId) {
    await notify({
      userId: memberId,
      householdId,
      type: "role_changed",
      title: role === "OWNER" ? `You're now an owner of ${owner.household.name}` : `You're now a regular member of ${owner.household.name}`,
      body: role === "OWNER" ? "Owners can change household settings and manage roommates." : undefined,
      link: "/household",
      dedupeKey: `role_changed:${householdId}:${memberId}:${role}:${Date.now()}`,
    });
  }
  return updated;
}

/** Tell the remaining roommates that tasks need a new owner. */
export async function notifyReleased(householdId: string, exclude: string[], name: string, count: number, stamp: number) {
  const others = await prisma.membership.findMany({ where: { householdId, leftAt: null, userId: { notIn: exclude } }, select: { userId: true } });
  for (const o of others) {
    await notify({
      userId: o.userId,
      householdId,
      type: "tasks_released",
      title: `${count} ${count === 1 ? "task" : "tasks"} from ${name} need a new owner`,
      body: `${name} is no longer in the household, so their open tasks are now unassigned.`,
      link: "/tasks?view=open",
      dedupeKey: `tasks_released:${householdId}:${name}:${stamp}:${o.userId}`,
    });
  }
}

/** Used by the leave flow so the same rules apply whether you leave or are removed. */
export async function leaveAndRelease(userId: string, householdId: string) {
  const m = await requireMember(userId, householdId);
  const result = await prisma.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: m.id }, data: { leftAt: new Date() } });
    return releaseMemberWork(tx, householdId, userId, userId, "left");
  });
  if (result.releasedOccurrences > 0) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
    await notifyReleased(householdId, [userId], user.name, result.releasedOccurrences, Date.now());
  }
  return result;
}

/** Open-task counts per member, shown next to "Remove" so the owner knows what gets released. */
export async function openTaskCounts(userId: string, householdId: string) {
  await requireMember(userId, householdId);
  const rows = await prisma.taskOccurrence.groupBy({
    by: ["assigneeId"],
    where: { householdId, status: "PENDING", assigneeId: { not: null } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.assigneeId as string, r._count._all]));
}
