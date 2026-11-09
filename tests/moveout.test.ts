import { describe, expect, it } from "vitest";
import { makeHousehold } from "./helpers";
import { createExpense, computeBalances } from "@/server/expenses";
import { leaveHousehold } from "@/server/households";
import { moveOutPlan, recordMoveOut, MOVE_OUT_NOTE } from "@/server/moveout";
import { prisma } from "@/server/db";

async function setup() {
  const h = await makeHousehold(2);
  const [owner, mate, third] = h.members;
  // Owner paid $90 split three ways; third paid $30 split three ways.
  await createExpense(owner.id, h.household.id, { payerId: owner.id, amountCents: 9000, date: "2026-03-04", description: "Groceries", splitMethod: "EQUAL", participants: [{ userId: owner.id }, { userId: mate.id }, { userId: third.id }] });
  await createExpense(third.id, h.household.id, { payerId: third.id, amountCents: 3000, date: "2026-03-05", description: "Soap", splitMethod: "EQUAL", participants: [{ userId: owner.id }, { userId: mate.id }, { userId: third.id }] });
  return { ...h, owner, mate, third };
}

describe("move-out settle-up", () => {
  it("plans payments that zero out exactly the person leaving", async () => {
    const { household, mate } = await setup();
    const plan = await moveOutPlan(mate.id, household.id, mate.id);
    expect(plan.cents).toBe(-4000);
    expect(plan.payments.reduce((s, p) => s + p.amountCents, 0)).toBe(4000);
    expect(plan.payments.every((p) => p.fromUserId === mate.id)).toBe(true);
  });

  it("won't let someone leave with a balance unless they confirm", async () => {
    const { household, mate } = await setup();
    await expect(leaveHousehold(mate.id, household.id)).rejects.toThrow(/You still owe \$40\.00/);
    await leaveHousehold(mate.id, household.id, { acknowledgeBalance: true });
    const m = await prisma.membership.findFirstOrThrow({ where: { householdId: household.id, userId: mate.id } });
    expect(m.leftAt).not.toBeNull();
  });

  it("records the payments once, even on a double tap, and then lets them leave", async () => {
    const { household, owner, mate, third } = await setup();
    const results = await Promise.allSettled([recordMoveOut(mate.id, household.id, mate.id), recordMoveOut(mate.id, household.id, mate.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: expect.objectContaining({ message: "Already settled up" }) });
    const { balances } = await computeBalances(owner.id, household.id);
    expect(balances.find((b) => b.userId === mate.id)?.cents).toBe(0);
    expect(balances.reduce((s, b) => s + b.cents, 0)).toBe(0);
    const recorded = await prisma.settlement.findMany({ where: { householdId: household.id } });
    expect(recorded.every((s) => s.note === MOVE_OUT_NOTE)).toBe(true);
    await leaveHousehold(mate.id, household.id);
    void third;
  });

  it("lets an owner settle a former member, but not another roommate", async () => {
    const { household, owner, mate, third } = await setup();
    await leaveHousehold(mate.id, household.id, { acknowledgeBalance: true });
    await expect(recordMoveOut(third.id, household.id, mate.id)).rejects.toThrow(/owner/);
    await expect(recordMoveOut(mate.id, household.id, mate.id)).rejects.toThrow(/not a member/);
    await recordMoveOut(owner.id, household.id, mate.id);
    expect((await moveOutPlan(owner.id, household.id, mate.id)).cents).toBe(0);
  });

  it("stays inside the household", async () => {
    const { household, mate } = await setup();
    const other = await makeHousehold(0, "Other");
    await expect(moveOutPlan(other.owner.id, household.id, mate.id)).rejects.toThrow();
    await expect(recordMoveOut(other.owner.id, household.id, mate.id)).rejects.toThrow();
    await expect(recordMoveOut(other.owner.id, other.household.id, mate.id)).rejects.toThrow(/not found/i);
  });
});
