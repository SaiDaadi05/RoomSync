import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { makeHousehold } from "./helpers";
import { createTask, nudgeOccurrence } from "@/server/tasks";
import { clearAway, setAway } from "@/server/away";
import { rebalanceSuggestions } from "@/server/handoffs";
import { prisma } from "@/server/db";

const tz = "America/New_York";
const day = (n: number) => DateTime.now().setZone(tz).plus({ days: n }).toISODate()!;

describe("away mode", () => {
  it("releases my chores in the window, tells roommates, and leaves the rest alone", async () => {
    const { household, owner, members } = await makeHousehold(1);
    const mate = members[1]!;
    await createTask(owner.id, household.id, { title: "Dishes", recurrence: "DAILY", startsOn: day(0), dueTime: "23:59", assignmentMode: "FIXED", assigneeId: mate.id });
    const r = await setAway(mate.id, household.id, { from: day(2), until: day(4), release: true });
    expect(r.released).toBe(3);
    const occs = await prisma.taskOccurrence.findMany({ where: { householdId: household.id }, orderBy: { dueAt: "asc" } });
    const local = (d: Date) => DateTime.fromJSDate(d).setZone(tz).toISODate()!;
    for (const o of occs) {
      const inWindow = local(o.dueAt) >= day(2) && local(o.dueAt) <= day(4);
      expect(o.assigneeId).toBe(inWindow ? null : mate.id);
    }
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: owner.id, type: "member_away" } });
    expect(note.body).toMatch(/3 of their chores are up for grabs: Dishes/);
  });

  it("can keep chores assigned when release is off", async () => {
    const { household, owner, members } = await makeHousehold(1);
    const mate = members[1]!;
    await createTask(owner.id, household.id, { title: "Trash", startsOn: day(1), dueTime: "21:00", assignmentMode: "FIXED", assigneeId: mate.id });
    expect((await setAway(mate.id, household.id, { from: day(0), until: day(3), release: false })).released).toBe(0);
    expect((await prisma.taskOccurrence.findFirstOrThrow({ where: { householdId: household.id } })).assigneeId).toBe(mate.id);
  });

  it("new slots in the window start up for grabs, rotation included", async () => {
    const { household, owner, members } = await makeHousehold(1);
    const mate = members[1]!;
    await setAway(mate.id, household.id, { from: day(0), until: day(6), release: true });
    await createTask(owner.id, household.id, { title: "Sweep", recurrence: "DAILY", startsOn: day(0), dueTime: "23:59", assignmentMode: "ROTATE", eligibleUserIds: [owner.id, mate.id] });
    const occs = await prisma.taskOccurrence.findMany({ where: { householdId: household.id } });
    const inWindow = occs.filter((o) => DateTime.fromJSDate(o.dueAt).setZone(tz).toISODate()! <= day(6));
    expect(inWindow.some((o) => o.assigneeId === mate.id)).toBe(false);
    expect(inWindow.some((o) => o.assigneeId === owner.id)).toBe(true);
    // After the window, mate is back in the rotation.
    expect(occs.some((o) => o.assigneeId === mate.id)).toBe(true);
  });

  it("can't nudge someone who's away", async () => {
    const { household, owner, members } = await makeHousehold(1);
    const mate = members[1]!;
    const t = await createTask(owner.id, household.id, { title: "Bathroom", startsOn: day(0), dueTime: "21:00", assignmentMode: "FIXED", assigneeId: mate.id });
    const occ = await prisma.taskOccurrence.findFirstOrThrow({ where: { definitionId: t.id } });
    await prisma.taskOccurrence.update({ where: { id: occ.id }, data: { dueAt: new Date(Date.now() - 3600_000) } });
    await setAway(mate.id, household.id, { from: day(0), until: day(2), release: false });
    await expect(nudgeOccurrence(owner.id, occ.id)).rejects.toThrow(/is away until/);
    await clearAway(mate.id, household.id);
    await expect(nudgeOccurrence(owner.id, occ.id)).resolves.toMatchObject({ sent: true });
  });

  it("rebalance never suggests moving work to someone who's away", async () => {
    const { household, owner, members } = await makeHousehold(1);
    const mate = members[1]!;
    for (const title of ["A", "B", "C", "D"]) {
      await createTask(owner.id, household.id, { title, startsOn: day(1), dueTime: "21:00", estimatedMinutes: 60, assignmentMode: "ROTATE", eligibleUserIds: [owner.id, mate.id] });
    }
    await prisma.taskOccurrence.updateMany({ where: { householdId: household.id }, data: { assigneeId: owner.id } });
    const range = { from: new Date(), to: DateTime.now().plus({ days: 7 }).toJSDate() };
    expect((await rebalanceSuggestions(owner.id, household.id, range)).length).toBeGreaterThan(0);
    await setAway(mate.id, household.id, { from: day(0), until: day(3), release: false });
    expect(await rebalanceSuggestions(owner.id, household.id, range)).toHaveLength(0);
  });

  it("validates dates", async () => {
    const { household, owner } = await makeHousehold(0);
    await expect(setAway(owner.id, household.id, { from: day(3), until: day(1) })).rejects.toThrow(/on or after/);
    await expect(setAway(owner.id, household.id, { from: day(-5), until: day(-2) })).rejects.toThrow(/already over/);
    await expect(setAway(owner.id, household.id, { from: day(0), until: day(120) })).rejects.toThrow(/90 days/);
  });
});
