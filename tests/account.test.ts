import { describe, expect, it } from "vitest";
import { makeHousehold, makeUser } from "./helpers";
import { prisma } from "@/server/db";
import { createSession, getUserBySessionToken, signUp, verifyLogin } from "@/server/auth";
import { createExpense, computeBalances } from "@/server/expenses";
import { leaveHousehold } from "@/server/households";
import { accountDeletionBlockers, deleteAccount, DELETED_NAME } from "@/server/account";
import { resetFeed } from "@/server/calendar/feed";

describe("delete account", () => {
  it("must move out first, and needs the password", async () => {
    const { household, members } = await makeHousehold(1);
    const mate = members[1]!;
    expect(await accountDeletionBlockers(mate.id)).toEqual([household.name]);
    await expect(deleteAccount(mate.id, "password123")).rejects.toThrow(/Move out of Test Apt first/);
    await leaveHousehold(mate.id, household.id);
    await expect(deleteAccount(mate.id, "wrong")).rejects.toThrow(/incorrect/);
  });

  it("wipes personal data but keeps the shared money history adding up", async () => {
    const { household, owner, members } = await makeHousehold(1);
    const mate = members[1]!;
    await prisma.user.update({ where: { id: mate.id }, data: { venmoHandle: "mate-v" } });
    await createExpense(mate.id, household.id, {
      payerId: mate.id, amountCents: 6000, date: "2026-11-01", description: "Internet", splitMethod: "EQUAL",
      participants: [{ userId: owner.id }, { userId: mate.id }],
    });
    await resetFeed(mate.id, household.id);
    const session = await createSession(mate.id);
    await leaveHousehold(mate.id, household.id, { acknowledgeBalance: true });

    await deleteAccount(mate.id, "password123");

    const u = await prisma.user.findUniqueOrThrow({ where: { id: mate.id } });
    expect(u).toMatchObject({ name: DELETED_NAME, venmoHandle: null, notifyEmail: false });
    expect(u.email).not.toBe(mate.email);
    expect(await getUserBySessionToken(session.token)).toBeNull();
    expect(await prisma.calendarFeed.count({ where: { userId: mate.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: mate.id } })).toBe(0);
    await expect(verifyLogin(mate.email, "password123")).rejects.toThrow();

    // The owner still owes the former roommate $30, under the new name.
    const { balances } = await computeBalances(owner.id, household.id);
    expect(balances.find((b) => b.userId === mate.id)).toMatchObject({ name: DELETED_NAME, cents: 3000, active: false });
    expect(balances.reduce((s, b) => s + b.cents, 0)).toBe(0);

    // The email is free for a new account.
    await expect(signUp({ name: "New", email: mate.email, password: "password123" })).resolves.toBeTruthy();
  });

  it("works for someone who never joined a household", async () => {
    const u = await makeUser("Solo");
    await deleteAccount(u.id, "password123");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).name).toBe(DELETED_NAME);
  });
});
