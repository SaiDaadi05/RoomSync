import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createDemoHousehold } from "@/server/demo";

describe("demo household", () => {
  it("comes with chore history: most past chores done before they were due, a few overdue", async () => {
    process.env.DEMO_MODE_ENABLED = "true";
    const { household } = await createDemoHousehold();
    const past = await prisma.taskOccurrence.findMany({ where: { householdId: household.id, dueAt: { lt: new Date(Date.now() - 86400_000) } } });
    const done = past.filter((o) => o.status === "DONE");
    expect(done.length).toBeGreaterThan(10);
    expect(past.length - done.length).toBeGreaterThan(0);
    for (const o of done) {
      expect(o.completedById).toBeTruthy();
      expect(o.completedAt!.getTime()).toBe(o.dueAt.getTime() - 3600_000);
    }
    const events = await prisma.taskEvent.findMany({ where: { type: "completed", occurrenceId: { in: done.map((o) => o.id) } } });
    expect(events).toHaveLength(done.length);
    expect(events.every((e) => e.actorId === done.find((o) => o.id === e.occurrenceId)!.completedById)).toBe(true);
  });
});

describe("demo clean up", () => {
  it("removes demo houses and their people after two days, and leaves real ones alone", async () => {
    process.env.DEMO_MODE_ENABLED = "true";
    const { cleanUpDemos } = await import("@/server/jobs");
    const { makeHousehold } = await import("./helpers");
    const real = await makeHousehold(1);
    const fresh = await createDemoHousehold();
    const old = await createDemoHousehold();
    const longAgo = new Date(Date.now() - 3 * 86400_000);
    await prisma.household.update({ where: { id: old.household.id }, data: { createdAt: longAgo } });
    const oldMembers = await prisma.membership.findMany({ where: { householdId: old.household.id } });
    await prisma.user.updateMany({ where: { id: { in: oldMembers.map((m) => m.userId) } }, data: { createdAt: longAgo } });
    await prisma.session.create({ data: { id: "demo-session", userId: old.user!.id, expiresAt: new Date(Date.now() + 86400_000) } });

    expect(await cleanUpDemos()).toEqual({ households: 1, users: 3 });
    expect(await prisma.household.findUnique({ where: { id: old.household.id } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: "demo-session" } })).toBeNull();
    expect(await prisma.household.findUnique({ where: { id: fresh.household.id } })).not.toBeNull();
    expect(await prisma.household.findUnique({ where: { id: real.household.id } })).not.toBeNull();
  });
});
