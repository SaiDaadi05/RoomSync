import { prisma } from "../db";
import { requireMember } from "../access";
import { AppError, forbidden, invalid, notFound } from "../errors";
import { createExpense, recordSettlement } from "../expenses";
import { addShoppingItem, markPurchased } from "../shopping";
import { completeOccurrence, createTask } from "../tasks";

/** Drafts expire so an old, forgotten draft can't be confirmed by accident later. */
export const DRAFT_TTL_MS = 24 * 3600_000;

type Payload = Record<string, unknown>;

async function execute(userId: string, householdId: string, kind: string, p: Payload): Promise<string | null> {
  switch (kind) {
    case "add_expense": {
      const e = await createExpense(userId, householdId, p);
      return `/expenses/${e.id}`;
    }
    case "record_settlement":
      await recordSettlement(userId, householdId, p);
      return "/expenses";
    case "add_shopping_items":
      for (const item of p.items as { name: string; quantity: string }[]) {
        try {
          await addShoppingItem(userId, householdId, item);
        } catch (e) {
          // Already on the list is fine; anything else is a real failure.
          if (!(e instanceof AppError && e.code === "CONFLICT")) throw e;
        }
      }
      return "/shopping";
    case "mark_bought":
      await markPurchased(userId, p.itemIds as string[]);
      return "/shopping";
    case "add_task": {
      const t = await createTask(userId, householdId, p);
      return `/tasks/${t.id}`;
    }
    case "complete_task":
      await completeOccurrence(userId, p.occurrenceId as string);
      return "/tasks";
    default:
      throw invalid("Unknown action");
  }
}

/**
 * Run a drafted action. Only the person who asked can confirm it, only once, and it runs
 * through the normal service functions, which re-check membership and validation.
 */
export async function confirmAction(userId: string, actionId: string) {
  const a = await prisma.assistantAction.findUnique({ where: { id: actionId } });
  if (!a) throw notFound("Draft");
  if (a.userId !== userId) throw forbidden("Only the person who asked can confirm this");
  await requireMember(userId, a.householdId);
  if (a.status !== "PENDING") throw invalid("This draft was already handled");
  if (Date.now() - a.createdAt.getTime() > DRAFT_TTL_MS) {
    await prisma.assistantAction.update({ where: { id: a.id }, data: { status: "DISCARDED", decidedAt: new Date(), error: "expired" } });
    throw invalid("This draft expired. Ask again.");
  }
  // Claim it first so a double tap can't run it twice.
  const claimed = await prisma.assistantAction.updateMany({ where: { id: a.id, status: "PENDING" }, data: { status: "CONFIRMED", decidedAt: new Date() } });
  if (claimed.count !== 1) throw invalid("This draft was already handled");
  try {
    const link = await execute(userId, a.householdId, a.kind, a.payload as Payload);
    return prisma.assistantAction.update({ where: { id: a.id }, data: { resultLink: link } });
  } catch (e) {
    const msg = e instanceof AppError ? e.message : e instanceof Error && e.name === "ZodError" ? "Some details weren't valid" : "Something went wrong";
    await prisma.assistantAction.update({ where: { id: a.id }, data: { status: "FAILED", error: msg } });
    throw e instanceof AppError ? e : invalid(msg);
  }
}

export async function discardAction(userId: string, actionId: string) {
  const a = await prisma.assistantAction.findUnique({ where: { id: actionId } });
  if (!a) throw notFound("Draft");
  if (a.userId !== userId) throw forbidden("Only the person who asked can discard this");
  await prisma.assistantAction.updateMany({ where: { id: a.id, status: "PENDING" }, data: { status: "DISCARDED", decidedAt: new Date() } });
}

export async function listPendingActions(userId: string, householdId: string) {
  await requireMember(userId, householdId);
  return prisma.assistantAction.findMany({
    where: { userId, householdId, status: "PENDING", createdAt: { gt: new Date(Date.now() - DRAFT_TTL_MS) } },
    orderBy: { createdAt: "asc" },
  });
}
