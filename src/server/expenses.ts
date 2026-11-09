import { z } from "zod";
import { prisma } from "./db";
import { activeMembers, assertAllMembers, requireMember } from "./access";
import { invalid, notFound } from "./errors";
import { splitEqually } from "@/lib/money";
import { allocateByWeights, itemizedSplit } from "@/lib/split";
import { deleteObject, putReceipt, readObject } from "./storage";

export const EXPENSE_CATEGORIES = ["groceries", "household supplies", "rent", "utilities", "internet", "food & dining", "furniture", "other"] as const;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");

const itemSchema = z.object({
  name: z.string().trim().min(1, "Name each item").max(80),
  amountCents: z.number().int().positive("Each item needs an amount"),
  userIds: z.array(z.string()).min(1, "Pick who shares each item"),
});

export const SPLIT_METHODS = ["EQUAL", "CUSTOM", "SHARES", "PERCENT", "ITEMIZED"] as const;

export const expenseInputSchema = z
  .object({
    payerId: z.string().min(1, "Who paid?"),
    amountCents: z.number().int("Amount must be in whole cents").positive("Amount must be more than $0").max(100_000_000),
    date: dateStr,
    description: z.string().trim().min(1, "Add a short description").max(140),
    category: z.string().trim().min(1).max(40).default("groceries"),
    splitMethod: z.enum(SPLIT_METHODS),
    participants: z
      .array(z.object({
        userId: z.string(),
        amountCents: z.number().int().nonnegative().optional(),
        weight: z.number().int().nonnegative().max(1_000_000).optional(),
      }))
      .default([]),
    items: z.array(itemSchema).max(100).default([]),
    shoppingItemIds: z.array(z.string()).default([]),
  })
  .transform((v) => (v.splitMethod === "ITEMIZED"
    // Itemized: the people are whoever appears on an item.
    ? { ...v, participants: [...new Set(v.items.flatMap((i) => i.userIds))].map((userId) => ({ userId } as { userId: string; amountCents?: number; weight?: number })) }
    : v))
  .superRefine((v, ctx) => {
    const issue = (message: string, path = "participants") => ctx.addIssue({ code: "custom", path: [path], message });
    const money = (c: number) => `$${(c / 100).toFixed(2)}`;
    if (v.participants.length === 0) return issue(v.splitMethod === "ITEMIZED" ? "Add at least one item" : "Pick at least one person to split with");
    const ids = v.participants.map((p) => p.userId);
    if (new Set(ids).size !== ids.length) issue("Each person can only appear once");
    switch (v.splitMethod) {
      case "CUSTOM": {
        if (v.participants.some((p) => p.amountCents === undefined)) issue("Enter an amount for each person");
        const sum = v.participants.reduce((s, p) => s + (p.amountCents ?? 0), 0);
        if (sum !== v.amountCents) issue(`Split amounts add up to ${money(sum)} but the total is ${money(v.amountCents)}`);
        break;
      }
      case "SHARES": {
        if (v.participants.some((p) => p.weight === undefined)) issue("Enter shares for each person");
        else if (!v.participants.some((p) => (p.weight ?? 0) > 0)) issue("Give at least one person a share");
        break;
      }
      case "PERCENT": {
        if (v.participants.some((p) => p.weight === undefined)) { issue("Enter a percent for each person"); break; }
        const sum = v.participants.reduce((s, p) => s + (p.weight ?? 0), 0);
        if (sum !== 10_000) issue(`Percents add up to ${Number((sum / 100).toFixed(2))}%, not 100%`);
        break;
      }
      case "ITEMIZED": {
        if (v.items.some((i) => new Set(i.userIds).size !== i.userIds.length)) issue("Each person can only be on an item once", "items");
        const sum = v.items.reduce((s, i) => s + i.amountCents, 0);
        if (sum > v.amountCents) issue(`Items add up to ${money(sum)}, more than the total of ${money(v.amountCents)}`, "items");
        break;
      }
    }
  });

export type ExpenseInput = z.input<typeof expenseInputSchema>;
type ExpenseData = z.output<typeof expenseInputSchema>;

/**
 * Compute the per-person split rows for a validated expense. Always sums to amountCents.
 * People whose share comes to $0 get no row.
 */
export function computeSplits(v: ExpenseData): { userId: string; amountCents: number; weight?: number }[] {
  switch (v.splitMethod) {
    case "EQUAL": {
      const parts = splitEqually(v.amountCents, v.participants.length);
      return v.participants.map((p, i) => ({ userId: p.userId, amountCents: parts[i] }));
    }
    case "CUSTOM":
      return v.participants.filter((p) => (p.amountCents ?? 0) > 0).map((p) => ({ userId: p.userId, amountCents: p.amountCents! }));
    case "SHARES":
    case "PERCENT": {
      const parts = allocateByWeights(v.amountCents, v.participants.map((p) => p.weight ?? 0));
      return v.participants.map((p, i) => ({ userId: p.userId, amountCents: parts[i], weight: p.weight })).filter((r) => r.amountCents > 0);
    }
    case "ITEMIZED": {
      const per = itemizedSplit(v.amountCents, v.items);
      return [...per.entries()].map(([userId, amountCents]) => ({ userId, amountCents })).filter((r) => r.amountCents > 0);
    }
  }
}

const itemRows = (v: ExpenseData) =>
  v.splitMethod === "ITEMIZED" ? v.items.map((i, position) => ({ position, name: i.name, amountCents: i.amountCents, userIds: i.userIds })) : [];

export async function createExpense(userId: string, householdId: string, input: unknown) {
  await requireMember(userId, householdId);
  const data = expenseInputSchema.parse(input);
  await assertAllMembers(householdId, [data.payerId, ...data.participants.map((p) => p.userId)]);
  const splits = computeSplits(data);

  return prisma.$transaction(async (tx) => {
    if (data.shoppingItemIds.length) {
      const items = await tx.shoppingItem.findMany({ where: { id: { in: data.shoppingItemIds } } });
      if (items.length !== data.shoppingItemIds.length || items.some((i) => i.householdId !== householdId))
        throw notFound("Shopping item");
      if (items.some((i) => i.expenseId)) throw invalid("Some of those items are already on another expense");
    }
    const expense = await tx.expense.create({
      data: {
        householdId,
        payerId: data.payerId,
        amountCents: data.amountCents,
        date: data.date,
        description: data.description,
        category: data.category,
        splitMethod: data.splitMethod,
        createdById: userId,
        splits: { create: splits },
        items: { create: itemRows(data) },
      },
      include: { splits: true },
    });
    if (data.shoppingItemIds.length) {
      // Linking items to the expense also marks them purchased by the payer — no double entry.
      await tx.shoppingItem.updateMany({
        where: { id: { in: data.shoppingItemIds } },
        data: { expenseId: expense.id, status: "PURCHASED", purchasedById: data.payerId, purchasedAt: new Date(), claimedById: null },
      });
    }
    return expense;
  });
}

/**
 * Edit an expense: amount, payer, date, description, category and splits. Splits are
 * replaced atomically and validated exactly like a new expense. Linked shopping items stay linked.
 */
export async function updateExpense(userId: string, expenseId: string, input: unknown) {
  const existing = await loadExpense(userId, expenseId);
  const data = expenseInputSchema.parse({ ...(input as object), shoppingItemIds: [] });
  await assertAllMembers(existing.householdId, [data.payerId, ...data.participants.map((p) => p.userId)]);
  const splits = computeSplits(data);
  return prisma.$transaction(async (tx) => {
    await tx.expenseSplit.deleteMany({ where: { expenseId } });
    await tx.expenseItem.deleteMany({ where: { expenseId } });
    return tx.expense.update({
      where: { id: expenseId },
      data: {
        payerId: data.payerId, amountCents: data.amountCents, date: data.date, description: data.description,
        category: data.category, splitMethod: data.splitMethod, editedAt: new Date(), editedById: userId,
        splits: { create: splits },
        items: { create: itemRows(data) },
      },
      include: { splits: true },
    });
  });
}

async function loadExpense(userId: string, expenseId: string) {
  const e = await prisma.expense.findUnique({ where: { id: expenseId }, include: { splits: true, shoppingItems: true, items: { orderBy: { position: "asc" } } } });
  if (!e || e.deletedAt) throw notFound("Expense");
  await requireMember(userId, e.householdId);
  return e;
}

export async function getExpense(userId: string, expenseId: string) {
  return loadExpense(userId, expenseId);
}

/** Soft delete so the history stays auditable; balances ignore deleted expenses. */
export async function deleteExpense(userId: string, expenseId: string) {
  const e = await loadExpense(userId, expenseId);
  await prisma.$transaction([
    prisma.expense.update({ where: { id: e.id }, data: { deletedAt: new Date() } }),
    prisma.shoppingItem.updateMany({ where: { expenseId: e.id }, data: { expenseId: null } }),
  ]);
}

export async function attachReceipt(userId: string, expenseId: string, buf: Buffer, mime: string) {
  const e = await loadExpense(userId, expenseId);
  const key = await putReceipt(e.householdId, buf, mime);
  await prisma.expense.update({ where: { id: e.id }, data: { receiptKey: key, receiptMime: mime } });
  if (e.receiptKey) await deleteObject(e.receiptKey).catch(() => {});
}

/** Only household members can read a receipt. */
export async function readReceipt(userId: string, expenseId: string) {
  const e = await loadExpense(userId, expenseId);
  if (!e.receiptKey || !e.receiptMime) throw notFound("Receipt");
  return { data: await readObject(e.receiptKey), mime: e.receiptMime };
}

// ---- Settlements ----

const settlementSchema = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  amountCents: z.number().int().positive("Amount must be more than $0").max(100_000_000),
  date: dateStr,
  note: z.string().trim().max(200).optional().nullable().transform((v) => v || null),
}).refine((v) => v.fromUserId !== v.toUserId, { message: "Pick two different people", path: ["toUserId"] });

export async function recordSettlement(userId: string, householdId: string, input: unknown) {
  await requireMember(userId, householdId);
  const data = settlementSchema.parse(input);
  await assertAllMembers(householdId, [data.fromUserId, data.toUserId]);
  return prisma.settlement.create({ data: { ...data, householdId, createdById: userId } });
}

export async function deleteSettlement(userId: string, settlementId: string) {
  const s = await prisma.settlement.findUnique({ where: { id: settlementId } });
  if (!s) throw notFound("Settlement");
  await requireMember(userId, s.householdId);
  await prisma.settlement.delete({ where: { id: s.id } });
}

// ---- Balances ----

/**
 * Net balance per person in cents. Positive = the household owes them; negative = they owe.
 *   paid an expense      → +amount
 *   their share of one   → −share
 *   paid someone back    → +amount (for the payer of the settlement), −amount for the receiver
 * Balances always sum to zero.
 */
export async function computeBalances(userId: string, householdId: string) {
  await requireMember(userId, householdId);
  const [net, members] = await Promise.all([
    netBalances(prisma, householdId),
    // Include former members too: they can still owe or be owed.
    prisma.membership.findMany({ where: { householdId }, include: { user: { select: { id: true, name: true } } } }),
  ]);
  const names = new Map(members.map((m) => [m.userId, m.user.name]));
  const balances = [...net.entries()].map(([id, cents]) => ({ userId: id, name: names.get(id) ?? "Unknown", cents, active: !members.find((m) => m.userId === id)?.leftAt }));
  return { balances, suggestions: simplifyDebts(balances) };
}

type Db = Pick<typeof prisma, "expense" | "settlement" | "membership">;

/** Net cents per person (everyone who was ever a member). No access check: callers do that. */
export async function netBalances(db: Db, householdId: string) {
  const [expenses, settlements, members] = await Promise.all([
    db.expense.findMany({ where: { householdId, deletedAt: null }, include: { splits: true } }),
    db.settlement.findMany({ where: { householdId } }),
    db.membership.findMany({ where: { householdId }, select: { userId: true } }),
  ]);
  const net = new Map<string, number>(members.map((m) => [m.userId, 0]));
  const add = (id: string, v: number) => net.set(id, (net.get(id) ?? 0) + v);
  for (const e of expenses) {
    add(e.payerId, e.amountCents);
    for (const s of e.splits) add(s.userId, -s.amountCents);
  }
  for (const s of settlements) {
    add(s.fromUserId, s.amountCents);
    add(s.toUserId, -s.amountCents);
  }
  return net;
}

/** Greedy debt simplification: at most n−1 payments that zero everyone out. Deterministic. */
export function simplifyDebts(balances: { userId: string; cents: number }[]) {
  const debtors = balances.filter((b) => b.cents < 0).map((b) => ({ id: b.userId, amt: -b.cents })).sort((a, b) => b.amt - a.amt || a.id.localeCompare(b.id));
  const creditors = balances.filter((b) => b.cents > 0).map((b) => ({ id: b.userId, amt: b.cents })).sort((a, b) => b.amt - a.amt || a.id.localeCompare(b.id));
  const out: { fromUserId: string; toUserId: string; amountCents: number }[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    if (pay > 0) out.push({ fromUserId: debtors[i].id, toUserId: creditors[j].id, amountCents: pay });
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt === 0) i++;
    if (creditors[j].amt === 0) j++;
  }
  return out;
}

export async function listLedger(userId: string, householdId: string, take = 100) {
  await requireMember(userId, householdId);
  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({ where: { householdId, deletedAt: null }, include: { splits: true, shoppingItems: { select: { id: true, name: true } } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take }),
    prisma.settlement.findMany({ where: { householdId }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take }),
  ]);
  type Entry = { kind: "expense"; date: string; createdAt: Date; expense: (typeof expenses)[number] } | { kind: "settlement"; date: string; createdAt: Date; settlement: (typeof settlements)[number] };
  const entries: Entry[] = [
    ...expenses.map((e) => ({ kind: "expense" as const, date: e.date, createdAt: e.createdAt, expense: e })),
    ...settlements.map((s) => ({ kind: "settlement" as const, date: s.date, createdAt: s.createdAt, settlement: s })),
  ];
  return entries.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.getTime() - a.createdAt.getTime());
}

export { activeMembers };
