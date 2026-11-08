import { z } from "zod";
import { DateTime } from "luxon";
import { prisma } from "./db";
import { assertAllMembers, requireMember } from "./access";
import { AppError, invalid, notFound } from "./errors";
import { createExpense } from "./expenses";
import { createTask, ensureOccurrences } from "./tasks";

const urlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => {
    try {
      const p = new URL(u);
      return p.protocol === "https:" || p.protocol === "http:";
    } catch {
      return false;
    }
  }, "Product links must start with http:// or https://");

const itemSchema = z.object({
  name: z.string().trim().min(1, "What do you need?").max(100),
  quantity: z.string().trim().max(30).optional().transform((v) => v || "1"),
  notes: z.string().trim().max(300).optional().nullable().transform((v) => v || null),
  productUrl: z.union([urlSchema, z.literal(""), z.null(), z.undefined()]).transform((v) => v || null),
});

export async function addShoppingItem(userId: string, householdId: string, input: unknown) {
  await requireMember(userId, householdId);
  const data = itemSchema.parse(input);
  // Gentle duplicate guard: if the same thing is already on the list and not bought, say so.
  const dupe = await prisma.shoppingItem.findFirst({
    where: { householdId, status: { not: "PURCHASED" }, name: { equals: data.name, mode: "insensitive" } },
  });
  if (dupe) throw new AppError(`“${dupe.name}” is already on the list`, "CONFLICT");
  return prisma.shoppingItem.create({ data: { ...data, householdId, addedById: userId } });
}

async function loadItem(userId: string, itemId: string) {
  const item = await prisma.shoppingItem.findUnique({ where: { id: itemId } });
  if (!item) throw notFound("Item");
  await requireMember(userId, item.householdId);
  return item;
}

export async function updateShoppingItem(userId: string, itemId: string, input: unknown) {
  const item = await loadItem(userId, itemId);
  const data = itemSchema.parse(input);
  if (item.status !== "PURCHASED") {
    const dupe = await prisma.shoppingItem.findFirst({
      where: { householdId: item.householdId, id: { not: item.id }, status: { not: "PURCHASED" }, name: { equals: data.name, mode: "insensitive" } },
    });
    if (dupe) throw new AppError(`“${dupe.name}” is already on the list`, "CONFLICT");
  }
  return prisma.shoppingItem.update({ where: { id: item.id }, data });
}

export async function deleteShoppingItem(userId: string, itemId: string) {
  const item = await loadItem(userId, itemId);
  if (item.expenseId) throw invalid("This item is part of a recorded expense; delete the expense first");
  await prisma.shoppingItem.delete({ where: { id: item.id } });
}

/** "I'll buy it" — atomic so two roommates can't both claim the same item. */
export async function claimShoppingItem(userId: string, itemId: string) {
  const item = await loadItem(userId, itemId);
  const res = await prisma.shoppingItem.updateMany({
    where: { id: item.id, status: "NEEDED" },
    data: { status: "CLAIMED", claimedById: userId },
  });
  if (res.count === 0) {
    const fresh = await prisma.shoppingItem.findUniqueOrThrow({ where: { id: item.id } });
    if (fresh.status === "CLAIMED" && fresh.claimedById === userId) return fresh;
    const who = fresh.claimedById ? (await prisma.user.findUnique({ where: { id: fresh.claimedById } }))?.name : null;
    throw new AppError(fresh.status === "PURCHASED" ? "Already bought" : `${who ?? "Someone"} is already getting this`, "CONFLICT");
  }
  return prisma.shoppingItem.findUniqueOrThrow({ where: { id: item.id } });
}

export async function unclaimShoppingItem(userId: string, itemId: string) {
  const item = await loadItem(userId, itemId);
  if (item.status !== "CLAIMED") return item;
  return prisma.shoppingItem.update({ where: { id: item.id }, data: { status: "NEEDED", claimedById: null } });
}

/** Mark bought without recording an expense (e.g. personal purchase, or expense added later). */
export async function markPurchased(userId: string, itemIds: string[]) {
  if (!itemIds.length) throw invalid("Pick at least one item");
  const items = await prisma.shoppingItem.findMany({ where: { id: { in: itemIds } } });
  if (items.length !== itemIds.length) throw notFound("Item");
  const householdIds = new Set(items.map((i) => i.householdId));
  if (householdIds.size !== 1) throw invalid("Items must belong to one household");
  await requireMember(userId, items[0].householdId);
  await prisma.shoppingItem.updateMany({
    where: { id: { in: itemIds }, status: { not: "PURCHASED" } },
    data: { status: "PURCHASED", purchasedById: userId, purchasedAt: new Date(), claimedById: null },
  });
}

export async function restockItem(userId: string, itemId: string) {
  const item = await loadItem(userId, itemId);
  const dupe = await prisma.shoppingItem.findFirst({
    where: { householdId: item.householdId, status: { not: "PURCHASED" }, name: { equals: item.name, mode: "insensitive" } },
  });
  if (dupe) throw new AppError(`“${item.name}” is already on the list`, "CONFLICT");
  return prisma.shoppingItem.create({
    data: { householdId: item.householdId, name: item.name, quantity: item.quantity, notes: item.notes, productUrl: item.productUrl, addedById: userId },
  });
}

/**
 * Check out a set of items as one purchase: marks them bought AND records the shared
 * expense in one step, so nobody has to type the same thing twice.
 */
export async function purchaseWithExpense(
  userId: string,
  householdId: string,
  input: { itemIds: string[]; amountCents: number; date: string; description?: string; category?: string; participantIds: string[]; payerId?: string },
) {
  if (!input.itemIds.length) throw invalid("Pick at least one item");
  const items = await prisma.shoppingItem.findMany({ where: { id: { in: input.itemIds }, householdId } });
  if (items.length !== input.itemIds.length) throw notFound("Item");
  const description = input.description?.trim() || (items.length === 1 ? items[0].name : `${items[0].name} + ${items.length - 1} more`);
  return createExpense(userId, householdId, {
    payerId: input.payerId ?? userId,
    amountCents: input.amountCents,
    date: input.date,
    description,
    category: input.category ?? "groceries",
    splitMethod: "EQUAL",
    participants: input.participantIds.map((id) => ({ userId: id })),
    shoppingItemIds: input.itemIds,
  });
}

/** Turn the selected items into a one-time "shopping run" errand and link them to it. */
export async function createShoppingErrand(
  userId: string,
  householdId: string,
  input: { itemIds: string[]; date?: string; assigneeId?: string | null },
) {
  const m = await requireMember(userId, householdId);
  if (!input.itemIds.length) throw invalid("Pick at least one item");
  if (input.assigneeId) await assertAllMembers(householdId, [input.assigneeId]);
  const items = await prisma.shoppingItem.findMany({ where: { id: { in: input.itemIds }, householdId, status: { not: "PURCHASED" } } });
  if (items.length !== input.itemIds.length) throw invalid("Some items are missing or already bought");
  const date = input.date || DateTime.now().setZone(m.household.timezone).toISODate()!;
  const def = await createTask(userId, householdId, {
    title: `Shopping run (${items.length} item${items.length === 1 ? "" : "s"})`,
    description: items.map((i) => `• ${i.name}${i.quantity !== "1" ? ` × ${i.quantity}` : ""}`).join("\n"),
    kind: "ERRAND",
    category: "groceries",
    estimatedMinutes: 30 + 2 * items.length,
    startsOn: date,
    dueTime: "19:00",
    assignmentMode: input.assigneeId ? "FIXED" : "UNASSIGNED",
    assigneeId: input.assigneeId ?? null,
  });
  await ensureOccurrences(householdId);
  const occ = await prisma.taskOccurrence.findFirstOrThrow({ where: { definitionId: def.id } });
  await prisma.shoppingItem.updateMany({
    where: { id: { in: input.itemIds } },
    data: {
      errandOccurrenceId: occ.id,
      ...(input.assigneeId ? { status: "CLAIMED", claimedById: input.assigneeId } : {}),
    },
  });
  return { def, occurrence: occ };
}

export async function listShopping(userId: string, householdId: string) {
  await requireMember(userId, householdId);
  const [open, recent] = await Promise.all([
    prisma.shoppingItem.findMany({
      where: { householdId, status: { not: "PURCHASED" } },
      include: { errandOccurrence: { include: { definition: { select: { id: true, title: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.shoppingItem.findMany({
      where: { householdId, status: "PURCHASED" },
      include: { expense: { select: { id: true, amountCents: true, description: true } } },
      orderBy: { purchasedAt: "desc" },
      take: 30,
    }),
  ]);
  return { open, recent };
}
