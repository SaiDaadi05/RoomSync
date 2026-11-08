import { prisma } from "./db";
import { requireMember } from "./access";
import { forbidden, invalid, notFound } from "./errors";
import { computeBalances, netBalances, simplifyDebts } from "./expenses";
import { todayIn } from "@/lib/time";

export const MOVE_OUT_NOTE = "Move-out settle-up";

/**
 * The payments that bring one person's balance to exactly zero. Taken from the household's
 * simplified debts, so they're consistent with the "Suggested payments" list. Only payments
 * involving `memberId` are returned, and they always sum to that person's balance.
 */
export async function moveOutPlan(viewerId: string, householdId: string, memberId: string) {
  const { balances, suggestions } = await computeBalances(viewerId, householdId);
  const me = balances.find((b) => b.userId === memberId);
  if (!me) throw notFound("Roommate");
  const names = new Map(balances.map((b) => [b.userId, b.name]));
  const payments = suggestions
    .filter((s) => s.fromUserId === memberId || s.toUserId === memberId)
    .map((s) => ({ ...s, fromName: names.get(s.fromUserId) ?? "Someone", toName: names.get(s.toUserId) ?? "Someone" }));
  return { userId: memberId, name: me.name, active: me.active, cents: me.cents, payments };
}

/**
 * Record the move-out payments as settlements (bookkeeping only: no money moves).
 * The person themselves or an owner can do it, including after the person has left.
 * Runs under a per-household lock and recomputes the plan inside it, so a double tap
 * can't record the payments twice.
 */
export async function recordMoveOut(viewerId: string, householdId: string, memberId: string) {
  const viewer = await requireMember(viewerId, householdId);
  if (viewerId !== memberId && viewer.role !== "OWNER") throw forbidden("Only the person moving out or an owner can do that");
  const target = await prisma.membership.findFirst({ where: { householdId, userId: memberId } });
  if (!target) throw notFound("Roommate");
  const household = await prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { timezone: true } });
  const date = todayIn(household.timezone);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"settle:" + householdId}))`;
    // Recompute from inside the lock (reads see settlements committed by an earlier tap).
    const net = await netBalances(tx, householdId);
    const payments = simplifyDebts([...net.entries()].map(([userId, cents]) => ({ userId, cents })))
      .filter((p) => p.fromUserId === memberId || p.toUserId === memberId);
    if (!payments.length) throw invalid("Already settled up");
    await tx.settlement.createMany({
      data: payments.map((p) => ({ ...p, householdId, date, note: MOVE_OUT_NOTE, createdById: viewerId })),
    });
    return payments;
  });
}
