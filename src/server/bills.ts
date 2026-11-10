import { z } from "zod";
import { DateTime } from "luxon";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { activeMembers, assertAllMembers, requireMember } from "./access";
import { AppError, forbidden, notFound } from "./errors";
import { computeSplits, expenseInputSchema } from "./expenses";
import { notify } from "./notifications";
import { formatCents } from "@/lib/money";

/**
 * Recurring bills (rent, internet, utilities). Each month on `dayOfMonth` in the household
 * timezone, the bill becomes a normal expense with the bill's split. A unique key on
 * (recurringBillId, period) means each month is added once, no matter how often
 * generation runs. Deleting that month's expense skips the month; it isn't re-added.
 */

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month");
export const billInputSchema = z.object({
  description: z.string().trim().min(1, "Name the bill").max(140),
  amountCents: z.number().int().positive("Amount must be more than $0").max(100_000_000),
  payerId: z.string().min(1, "Who pays it?"),
  category: z.string().trim().min(1).max(40).default("rent"),
  splitMethod: z.enum(["EQUAL", "CUSTOM"]),
  participants: z.array(z.object({ userId: z.string(), amountCents: z.number().int().nonnegative().optional() })).min(1, "Pick at least one person to split with"),
  dayOfMonth: z.coerce.number().int().min(1, "Day must be 1–28").max(28, "Use a day from 1 to 28 so it exists every month"),
  startMonth: month,
  /** Split equally among current members each month; participants is then ignored. Left out on edit = unchanged. */
  splitWithEveryone: z.boolean().optional(),
});

/** Reuse the one-off expense rules (custom splits must add up exactly, no duplicates). */
function validate(input: unknown) {
  const bill = billInputSchema.parse(input);
  const asExpense = expenseInputSchema.parse({ ...bill, date: `${bill.startMonth}-01` });
  return { bill: { ...bill, participants: asExpense.participants }, asExpense };
}

const MAX_CATCH_UP_MONTHS = 12;

async function loadBill(userId: string, billId: string) {
  const b = await prisma.recurringBill.findUnique({ where: { id: billId } });
  if (!b) throw notFound("Bill");
  const m = await requireMember(userId, b.householdId);
  return { bill: b, membership: m };
}

/** The person who set up a bill, or a household owner, can change it. */
async function loadEditableBill(userId: string, billId: string) {
  const r = await loadBill(userId, billId);
  if (r.bill.createdById !== userId && r.membership.role !== "OWNER") throw forbidden("Only the person who set up this bill or an owner can change it");
  return r;
}

export async function createBill(userId: string, householdId: string, input: unknown) {
  await requireMember(userId, householdId);
  const { bill } = validate(input);
  await assertAllMembers(householdId, [bill.payerId, ...bill.participants.map((p) => p.userId)]);
  const created = await prisma.recurringBill.create({
    data: { ...bill, participants: bill.participants as Prisma.InputJsonValue, householdId, createdById: userId },
  });
  await ensureBillExpenses(householdId);
  return created;
}

export async function updateBill(userId: string, billId: string, input: unknown) {
  const { bill: existing } = await loadEditableBill(userId, billId);
  const { bill } = validate(input);
  await assertAllMembers(existing.householdId, [bill.payerId, ...bill.participants.map((p) => p.userId)]);
  // Months already added keep their amounts; only future months use the new values.
  const updated = await prisma.recurringBill.update({
    where: { id: billId },
    data: { ...bill, participants: bill.participants as Prisma.InputJsonValue, lastError: null },
  });
  await ensureBillExpenses(existing.householdId);
  return updated;
}

export async function setBillPaused(userId: string, billId: string, paused: boolean) {
  await loadEditableBill(userId, billId);
  return prisma.recurringBill.update({ where: { id: billId }, data: { pausedAt: paused ? new Date() : null } });
}

/** Stops future months. Expenses already added stay (and stay in balances). */
export async function deleteBill(userId: string, billId: string) {
  await loadEditableBill(userId, billId);
  await prisma.recurringBill.delete({ where: { id: billId } });
}

export async function listBills(userId: string, householdId: string) {
  await requireMember(userId, householdId);
  await ensureBillExpenses(householdId);
  return prisma.recurringBill.findMany({
    where: { householdId },
    include: { expenses: { where: { deletedAt: null }, orderBy: { period: "desc" }, take: 1, select: { id: true, period: true } } },
    orderBy: [{ pausedAt: { sort: "asc", nulls: "first" } }, { dayOfMonth: "asc" }],
  });
}

export async function getBill(userId: string, billId: string) {
  return (await loadBill(userId, billId)).bill;
}

/** Months (YYYY-MM) from start through `now`, counting a month only once its day has arrived. */
export function dueMonths(startMonth: string, dayOfMonth: number, now: DateTime): string[] {
  const out: string[] = [];
  let m: DateTime = DateTime.fromFormat(startMonth, "yyyy-LL", { zone: now.zone }).startOf("month");
  const floor = now.startOf("month").minus({ months: MAX_CATCH_UP_MONTHS - 1 });
  if (m < floor) m = floor;
  while (m <= now) {
    const due = m.set({ day: dayOfMonth }).startOf("day");
    if (due <= now) out.push(m.toFormat("yyyy-LL"));
    m = m.plus({ months: 1 });
  }
  return out;
}

/**
 * Add any months that are due and not yet added, for every active bill in the household.
 * Safe to call often (page loads, the worker): it's idempotent.
 */
export async function ensureBillExpenses(householdId: string, nowDate = new Date()) {
  const household = await prisma.household.findUnique({ where: { id: householdId }, select: { timezone: true } });
  if (!household) return 0;
  const now = DateTime.fromJSDate(nowDate).setZone(household.timezone);
  const bills = await prisma.recurringBill.findMany({ where: { householdId, pausedAt: null } });
  let added = 0;
  for (const bill of bills) {
    const months = dueMonths(bill.startMonth, bill.dayOfMonth, now);
    if (!months.length) continue;
    const have = new Set((await prisma.expense.findMany({ where: { recurringBillId: bill.id, period: { in: months } }, select: { period: true } })).map((e) => e.period));
    for (const period of months.filter((p) => !have.has(p))) {
      const date = `${period}-${String(bill.dayOfMonth).padStart(2, "0")}`;
      let data;
      try {
        data = expenseInputSchema.parse({
          payerId: bill.payerId, amountCents: bill.amountCents, date, description: `${bill.description} (${DateTime.fromFormat(period, "yyyy-LL").toFormat("LLLL")})`,
          category: bill.category,
          ...(bill.splitWithEveryone
            ? { splitMethod: "EQUAL", participants: (await activeMembers(householdId)).map((m) => ({ userId: m.id })) }
            : { splitMethod: bill.splitMethod, participants: bill.participants }),
        });
        await assertAllMembers(householdId, [data.payerId, ...data.participants.map((p) => p.userId)]);
      } catch (e) {
        // Usually someone in the split left. Don't guess a new split: tell whoever set it up.
        const reason = e instanceof AppError ? "someone in the split is no longer in the household" : "its split is no longer valid";
        await prisma.recurringBill.update({ where: { id: bill.id }, data: { lastError: `Couldn't add ${period}: ${reason}. Edit the bill to fix it.` } });
        await notify({
          userId: bill.createdById, householdId, type: "bill_failed",
          title: `“${bill.description}” wasn't added for ${period}`,
          body: `${reason[0].toUpperCase()}${reason.slice(1)}. Edit the bill to fix the split.`,
          link: `/expenses/bills/${bill.id}`, dedupeKey: `bill_failed:${bill.id}:${period}`,
        });
        break;
      }
      const splits = computeSplits(data);
      try {
        const expense = await prisma.expense.create({
          data: {
            householdId, payerId: data.payerId, amountCents: data.amountCents, date: data.date, description: data.description,
            category: data.category, splitMethod: data.splitMethod, createdById: bill.createdById,
            recurringBillId: bill.id, period, splits: { create: splits },
          },
        });
        added++;
        for (const s of splits) {
          if (s.userId === data.payerId) continue;
          await notify({
            userId: s.userId, householdId, type: "bill_added",
            title: `${data.description} was added: your share is ${formatCents(s.amountCents)}`,
            link: `/expenses/${expense.id}`, dedupeKey: `bill_added:${bill.id}:${period}:${s.userId}`,
          });
        }
      } catch (e) {
        // Another request added this month at the same moment. That's fine.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      }
    }
    // Clear an old problem once every due month has been added.
    if (bill.lastError) {
      const addedMonths = await prisma.expense.count({ where: { recurringBillId: bill.id, period: { in: months } } });
      if (addedMonths === months.length) await prisma.recurringBill.update({ where: { id: bill.id }, data: { lastError: null } });
    }
  }
  return added;
}

/** For the worker: every household with an active bill. */
export async function ensureAllBillExpenses(now = new Date()) {
  const rows = await prisma.recurringBill.findMany({ where: { pausedAt: null }, select: { householdId: true }, distinct: ["householdId"] });
  let total = 0;
  for (const r of rows) total += await ensureBillExpenses(r.householdId, now);
  return total;
}

