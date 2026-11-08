import { z } from "zod";
import { prisma } from "./db";
import { activeMembers, assertAllMembers, requireMember } from "./access";
import { invalid, notFound } from "./errors";
import { splitEqually } from "@/lib/money";
import { deleteObject, putReceipt, readObject } from "./storage";

export const EXPENSE_CATEGORIES = ["groceries", "household supplies", "rent", "utilities", "internet", "food & dining", "furniture", "other"] as const;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");

export const expenseInputSchema = z
  .object({
    payerId: z.string().min(1, "Who paid?"),
    amountCents: z.number().int("Amount must be in whole cents").positive("Amount must be more than $0").max(100_000_000),
    date: dateStr,
    description: z.string().trim().min(1, "Add a short description").max(140),
    category: z.string().trim().min(1).max(40).default("groceries"),
    splitMethod: z.enum(["EQUAL", "CUSTOM"]),
    participants: z
      .array(z.object({ userId: z.string(), amountCents: z.number().int().nonnegative().optional() }))
      .min(1, "Pick at least one person to split with"),
    shoppingItemIds: z.array(z.string()).default([]),
  })
  .superRefine((v, ctx) => {
    const ids = v.participants.map((p) => p.userId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["participants"], message: "Each person can only appear once" });
    if (v.splitMethod === "CUSTOM") {
      if (v.participants.some((p) => p.amountCents === undefined))
        ctx.addIssue({ code: "custom", path: ["participants"], message: "Enter an amount for each person" });
      const sum = v.participants.reduce((s, p) => s + (p.amountCents ?? 0), 0);
      if (sum !== v.amountCents)
        ctx.addIssue({
          code: "custom", path: ["participants"],
          message: `Split amounts add up to $${(sum / 100).toFixed(2)} but the total is $${(v.amountCents / 100).toFixed(2)}`,
        });
    }
  });

export type ExpenseInput = z.input<typeof expenseInputSchema>;

/** Compute the per-person split rows for a validated expense. Always sums to amountCents. */
export function computeSplits(v: z.output<typeof expenseInputSchema>) {
  if (v.splitMethod === "EQUAL") {
    const parts = splitEqually(v.amountCents, v.participants.length);
    return v.participants.map((p, i) => ({ userId: p.userId, amountCents: parts[i] }));
  }
  return v.participants.filter((p) => (p.amountCents ?? 0) > 0).map((p) => ({ userId: p.userId, amountCents: p.amountCents! }));
}

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

async function loadExpense(userId: string, expenseId: string) {
  const e = await prisma.expense.findUnique({ where: { id: expenseId }, include: { splits: true, shoppingItems: true } });
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
  const [expenses, settlements, members] = await Promise.all([
    prisma.expense.findMany({ where: { householdId, deletedAt: null }, include: { splits: true } }),
    prisma.settlement.findMany({ where: { householdId } }),
    // Include former members too: they can still owe or be owed.
    prisma.membership.findMany({ where: { householdId }, include: { user: { select: { id: true, name: true } } } }),
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
  const names = new Map(members.map((m) => [m.userId, m.user.name]));
  const balances = [...net.entries()].map(([id, cents]) => ({ userId: id, name: names.get(id) ?? "Unknown", cents, active: !members.find((m) => m.userId === id)?.leftAt }));
  return { balances, suggestions: simplifyDebts(balances) };
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
