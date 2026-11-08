import { describe, expect, it } from "vitest";
import { makeHousehold, makeUser } from "./helpers";
import { acceptInvitation, createInvitation, getHouseholdOverview, revokeInvitation } from "@/server/households";
import { createTask, completeOccurrence, listOccurrences, getTask } from "@/server/tasks";
import { createSession, getUserBySessionToken, verifyLogin, deleteSession } from "@/server/auth";
import { prisma } from "@/server/db";

describe("auth", () => {
  it("logs in with the right password only and stores hashed session tokens", async () => {
    const u = await makeUser("Al");
    await expect(verifyLogin(u.email, "wrong-password")).rejects.toThrow(/incorrect/);
    const ok = await verifyLogin(u.email.toUpperCase(), "password123");
    expect(ok.id).toBe(u.id);
    const { token } = await createSession(u.id);
    const row = await prisma.session.findFirstOrThrow({ where: { userId: u.id } });
    expect(row.id).not.toBe(token);
    expect((await getUserBySessionToken(token))?.id).toBe(u.id);
    await deleteSession(token);
    expect(await getUserBySessionToken(token)).toBeNull();
  });
});

describe("invitations", () => {
  it("lets a user join with a code exactly once", async () => {
    const { household, owner } = await makeHousehold(0);
    const inv = await createInvitation(owner.id, household.id);
    const a = await makeUser("A");
    const b = await makeUser("B");
    await acceptInvitation(a.id, inv.code.toLowerCase());
    await expect(acceptInvitation(b.id, inv.code)).rejects.toThrow(/invalid or has expired/);
    const overview = await getHouseholdOverview(a.id, household.id);
    expect(overview.members.map((m) => m.id).sort()).toEqual([owner.id, a.id].sort());
  });

  it("rejects revoked and email-restricted invites", async () => {
    const { household, owner } = await makeHousehold(0);
    const a = await makeUser("A");
    const r = await createInvitation(owner.id, household.id);
    await revokeInvitation(owner.id, r.id);
    await expect(acceptInvitation(a.id, r.code)).rejects.toThrow();
    const e = await createInvitation(owner.id, household.id, "someone-else@test.dev");
    await expect(acceptInvitation(a.id, e.code)).rejects.toThrow(/different email/);
  });
});

describe("household isolation", () => {
  it("prevents outsiders from reading or changing another household's data", async () => {
    const h1 = await makeHousehold(1, "Apt 1");
    const h2 = await makeHousehold(1, "Apt 2");
    const task = await createTask(h1.owner.id, h1.household.id, { title: "Dishes", startsOn: "2030-01-01" });
    const [occ] = await listOccurrences(h1.owner.id, h1.household.id);

    await expect(getHouseholdOverview(h2.owner.id, h1.household.id)).rejects.toThrow(/not a member/);
    await expect(listOccurrences(h2.owner.id, h1.household.id)).rejects.toThrow(/not a member/);
    await expect(getTask(h2.owner.id, task.id)).rejects.toThrow(/not a member/);
    await expect(completeOccurrence(h2.owner.id, occ.id)).rejects.toThrow(/not a member/);
    await expect(createInvitation(h2.owner.id, h1.household.id)).rejects.toThrow(/not a member/);
    // Can't assign a task to someone from a different household
    await expect(
      createTask(h1.owner.id, h1.household.id, {
        title: "Trash", startsOn: "2030-01-01", assignmentMode: "FIXED", assigneeId: h2.owner.id,
      }),
    ).rejects.toThrow(/member of this household/);
  });
});

describe("demo mode isolation", () => {
  it("creates a flagged demo household and blocks mixing demo and real accounts", async () => {
    process.env.DEMO_MODE_ENABLED = "true";
    const { createDemoHousehold } = await import("@/server/demo");
    const { household: demo, user: demoUser } = await createDemoHousehold();
    expect(demo.isDemo).toBe(true);
    expect(demoUser.isDemo).toBe(true);
    expect(demoUser.email).toMatch(/@demo\.roomsync\.invalid$/);
    const real = await makeHousehold(0);
    const toReal = await createInvitation(real.owner.id, real.household.id);
    await expect(acceptInvitation(demoUser.id, toReal.code)).rejects.toThrow(/Demo and real/);
    const toDemo = await createInvitation(demoUser.id, demo.id);
    await expect(acceptInvitation(real.owner.id, toDemo.code)).rejects.toThrow(/Demo and real/);
    // Sample data is present and balances add up
    const { computeBalances } = await import("@/server/expenses");
    const { balances } = await computeBalances(demoUser.id, demo.id);
    expect(balances.reduce((s, b) => s + b.cents, 0)).toBe(0);
  });
});
