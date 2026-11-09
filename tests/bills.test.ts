import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { makeHousehold } from "./helpers";
import { createBill, deleteBill, dueMonths, ensureBillExpenses, setBillPaused, updateBill } from "@/server/bills";
import { computeBalances, deleteExpense } from "@/server/expenses";
import { leaveHousehold } from "@/server/households";
import { prisma } from "@/server/db";

const TZ = "America/New_York";
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();

describe("dueMonths", () => {
  it("counts a month only once its day has arrived, in the household timezone", () => {
    const now = DateTime.fromISO("2031-03-05T10:00", { zone: TZ });
    expect(dueMonths("2031-01", 5, now)).toEqual(["2031-01", "2031-02", "2031-03"]);
    expect(dueMonths("2031-01", 6, now)).toEqual(["2031-01", "2031-02"]);
    expect(dueMonths("2031-04", 1, now)).toEqual([]);
  });
  it("catches up at most 12 months", () => {
    expect(dueMonths("2020-01", 1, DateTime.fromISO("2031-03-05", { zone: TZ }))).toHaveLength(12);
  });
});

async function bill(householdId: string, userId: string, members: string[], over: Record<string, unknown> = {}) {
  return createBill(userId, householdId, {
    description: "Rent", amountCents: 200000, payerId: userId, category: "rent", splitMethod: "EQUAL",
    participants: members.map((id) => ({ userId: id })), dayOfMonth: 1, startMonth: "2031-01", ...over,
  });
}

describe("recurring bills", () => {
  it("adds each due month exactly once, with exact splits", async () => {
    const { household, owner, members } = await makeHousehold(2);
    const ids = members.map((m) => m.id);
    const b = await bill(household.id, owner.id, ids, { amountCents: 100000 }); // $1,000 / 3
    await prisma.expense.deleteMany({ where: { recurringBillId: b.id } }); // ignore anything added "today"
    await prisma.recurringBill.update({ where: { id: b.id }, data: { startMonth: "2031-01" } });

    expect(await ensureBillExpenses(household.id, at("2031-02-15T12:00"))).toBe(2);
    expect(await ensureBillExpenses(household.id, at("2031-02-15T12:00"))).toBe(0); // idempotent
    const exps = await prisma.expense.findMany({ where: { recurringBillId: b.id }, include: { splits: true }, orderBy: { period: "asc" } });
    expect(exps.map((e) => [e.period, e.date, e.description])).toEqual([["2031-01", "2031-01-01", "Rent (January)"], ["2031-02", "2031-02-01", "Rent (February)"]]);
    for (const e of exps) {
      expect(e.splits.map((s) => s.amountCents).sort()).toEqual([33333, 33333, 33334]);
      expect(e.splits.reduce((s, x) => s + x.amountCents, 0)).toBe(100000);
    }
    // Roommates are told their share; the payer isn't.
    expect(await prisma.notification.count({ where: { userId: members[1].id, type: "bill_added" } })).toBe(2);
    expect(await prisma.notification.count({ where: { userId: owner.id, type: "bill_added" } })).toBe(0);
  });

  it("keeps custom splits exact and rejects ones that don't add up", async () => {
    const { household, owner, members: [, a] } = await makeHousehold(1);
    await expect(bill(household.id, owner.id, [], { splitMethod: "CUSTOM", participants: [{ userId: owner.id, amountCents: 120000 }, { userId: a.id, amountCents: 70000 }] })).rejects.toThrow(/add up/);
    const b = await bill(household.id, owner.id, [], { splitMethod: "CUSTOM", participants: [{ userId: owner.id, amountCents: 120000 }, { userId: a.id, amountCents: 80000 }] });
    await prisma.expense.deleteMany({ where: { recurringBillId: b.id } });
    await ensureBillExpenses(household.id, at("2031-01-02T00:00"));
    const { balances } = await computeBalances(owner.id, household.id);
    expect(balances.find((x) => x.userId === a.id)?.cents).toBe(-80000);
  });

  it("skips a month whose expense was deleted, and pausing stops new months", async () => {
    const { household, owner, members } = await makeHousehold(1);
    const b = await bill(household.id, owner.id, members.map((m) => m.id));
    await prisma.expense.deleteMany({ where: { recurringBillId: b.id } });
    await ensureBillExpenses(household.id, at("2031-01-02T00:00"));
    const jan = await prisma.expense.findFirstOrThrow({ where: { recurringBillId: b.id, period: "2031-01" } });
    await deleteExpense(owner.id, jan.id);
    await setBillPaused(owner.id, b.id, true);
    expect(await ensureBillExpenses(household.id, at("2031-03-02T00:00"))).toBe(0);
    await setBillPaused(owner.id, b.id, false);
    expect(await ensureBillExpenses(household.id, at("2031-03-02T00:00"))).toBe(2); // Feb + Mar, not Jan again
  });

  it("editing changes only future months; deleting keeps past expenses", async () => {
    const { household, owner, members } = await makeHousehold(1);
    const ids = members.map((m) => m.id);
    const b = await bill(household.id, owner.id, ids);
    await prisma.expense.deleteMany({ where: { recurringBillId: b.id } });
    await ensureBillExpenses(household.id, at("2031-01-02T00:00"));
    await updateBill(owner.id, b.id, { description: "Rent", amountCents: 210000, payerId: owner.id, category: "rent", splitMethod: "EQUAL", participants: ids.map((userId) => ({ userId })), dayOfMonth: 1, startMonth: "2031-01" });
    await ensureBillExpenses(household.id, at("2031-02-02T00:00"));
    const amounts = (await prisma.expense.findMany({ where: { householdId: household.id, period: { in: ["2031-01", "2031-02"] } }, orderBy: { period: "asc" } })).map((e) => e.amountCents);
    expect(amounts).toEqual([200000, 210000]);
    await deleteBill(owner.id, b.id);
    expect(await prisma.expense.count({ where: { householdId: household.id, deletedAt: null, period: { not: null } } })).toBeGreaterThanOrEqual(2);
  });

  it("only the creator or an owner can change a bill; outsiders can't see it", async () => {
    const { household, owner, members: [, mate] } = await makeHousehold(1);
    const outside = await makeHousehold(0);
    const b = await bill(household.id, owner.id, [owner.id, mate.id]);
    await expect(setBillPaused(mate.id, b.id, true)).rejects.toThrow(/set up this bill/);
    await expect(deleteBill(outside.owner.id, b.id)).rejects.toThrow(/not a member/);
    await expect(createBill(owner.id, household.id, { description: "x", amountCents: 100, payerId: owner.id, splitMethod: "EQUAL", participants: [{ userId: outside.owner.id }], dayOfMonth: 1, startMonth: "2031-01" })).rejects.toThrow(/member of this household/);
    await expect(bill(household.id, owner.id, [owner.id], { dayOfMonth: 31 })).rejects.toThrow(/1 to 28/);
  });

  it("stops and tells the creator when someone in the split leaves", async () => {
    const { household, owner, members: [, mate] } = await makeHousehold(1);
    const b = await bill(household.id, owner.id, [owner.id, mate.id]);
    await prisma.expense.deleteMany({ where: { recurringBillId: b.id } });
    await leaveHousehold(mate.id, household.id);
    expect(await ensureBillExpenses(household.id, at("2031-01-02T00:00"))).toBe(0);
    const after = await prisma.recurringBill.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.lastError).toMatch(/no longer in the household/);
    expect(await prisma.notification.count({ where: { userId: owner.id, type: "bill_failed" } })).toBe(1);
  });
});
