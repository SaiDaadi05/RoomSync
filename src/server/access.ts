import { prisma } from "./db";
import { forbidden } from "./errors";

/**
 * The single authorization gate for household data. Every service function that
 * reads or writes household-owned rows calls this first with the acting user.
 */
export async function requireMember(userId: string, householdId: string) {
  const membership = await prisma.membership.findUnique({
    where: { householdId_userId: { householdId, userId } },
    include: { household: true },
  });
  if (!membership || membership.leftAt) throw forbidden("You're not a member of this household");
  return membership;
}

export async function requireOwner(userId: string, householdId: string) {
  const m = await requireMember(userId, householdId);
  if (m.role !== "OWNER") throw forbidden("Only the household owner can do that");
  return m;
}

/** Throws unless every user id is an active member of the household. */
export async function assertAllMembers(householdId: string, userIds: string[]) {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  const count = await prisma.membership.count({
    where: { householdId, userId: { in: unique }, leftAt: null },
  });
  if (count !== unique.length) throw forbidden("Everyone involved must be a member of this household");
}

export async function activeMembers(householdId: string) {
  const rows = await prisma.membership.findMany({
    where: { householdId, leftAt: null },
    include: { user: { select: { id: true, name: true, email: true, timezone: true, preferredStartMin: true, preferredEndMin: true } } },
    orderBy: { joinedAt: "asc" },
  });
  return rows.map((r) => ({ ...r.user, role: r.role, joinedAt: r.joinedAt }));
}
