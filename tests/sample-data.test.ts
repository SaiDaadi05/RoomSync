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
