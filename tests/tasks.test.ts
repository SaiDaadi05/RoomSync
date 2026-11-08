import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { makeHousehold } from "./helpers";
import { generateSlots } from "@/lib/recurrence";
import {
  createTask, ensureOccurrences, listOccurrences, completeOccurrence, skipOccurrence,
  reopenOccurrence, assignOccurrence, rescheduleOccurrence, updateTask, getTask,
} from "@/server/tasks";
import { prisma } from "@/server/db";

const TZ = "America/New_York";

describe("recurrence engine", () => {
  it("generates weekly slots on chosen weekdays with stable sequence numbers", () => {
    const rule = { recurrence: "WEEKLY" as const, interval: 1, weekdays: [1, 4], startsOn: "2026-03-02", dueTime: "19:00" };
    const all = generateSlots(rule, TZ, "2026-03-02", "2026-03-15");
    expect(all.map((s) => s.localDate)).toEqual(["2026-03-02", "2026-03-05", "2026-03-09", "2026-03-12"]);
    expect(all.map((s) => s.sequence)).toEqual([0, 1, 2, 3]);
    // Asking for a later window yields the same sequence numbers
    const later = generateSlots(rule, TZ, "2026-03-09", "2026-03-15");
    expect(later.map((s) => s.sequence)).toEqual([2, 3]);
  });

  it("keeps the local due time across a DST change", () => {
    const rule = { recurrence: "DAILY" as const, interval: 1, weekdays: [], startsOn: "2026-03-07", dueTime: "20:00" };
    const slots = generateSlots(rule, TZ, "2026-03-07", "2026-03-09");
    const local = slots.map((s) => DateTime.fromJSDate(s.dueAt).setZone(TZ).toFormat("yyyy-MM-dd HH:mm"));
    expect(local).toEqual(["2026-03-07 20:00", "2026-03-08 20:00", "2026-03-09 20:00"]);
    // 20:00 EST = 01:00Z, 20:00 EDT = 00:00Z
    expect(slots[0].dueAt.toISOString()).toBe("2026-03-08T01:00:00.000Z");
    expect(slots[2].dueAt.toISOString()).toBe("2026-03-10T00:00:00.000Z");
  });

  it("supports every-other-week and every-N-days and respects end dates", () => {
    const biweekly = generateSlots(
      { recurrence: "WEEKLY", interval: 2, weekdays: [6], startsOn: "2026-01-03", dueTime: "10:00" }, TZ, "2026-01-01", "2026-02-01");
    expect(biweekly.map((s) => s.localDate)).toEqual(["2026-01-03", "2026-01-17", "2026-01-31"]);
    const every3 = generateSlots(
      { recurrence: "DAILY", interval: 3, weekdays: [], startsOn: "2026-01-01", endsOn: "2026-01-08", dueTime: "10:00" }, TZ, "2026-01-01", "2026-02-01");
    expect(every3.map((s) => s.localDate)).toEqual(["2026-01-01", "2026-01-04", "2026-01-07"]);
  });
});

describe("first flow: create household, add chore, assign, complete", () => {
  it("works end to end and records history", async () => {
    const { household, owner, members } = await makeHousehold(1);
    const mate = members[1];
    const today = DateTime.now().setZone(TZ).toISODate()!;
    const task = await createTask(owner.id, household.id, { title: "Take out trash", category: "trash", startsOn: today, estimatedMinutes: 5 });
    const [occ] = await listOccurrences(owner.id, household.id, { status: "PENDING" });
    expect(occ.definitionId).toBe(task.id);
    expect(occ.assigneeId).toBeNull();

    await assignOccurrence(owner.id, occ.id, mate.id);
    const notif = await prisma.notification.findFirst({ where: { userId: mate.id, type: "task_assigned" }, include: { deliveries: true } });
    expect(notif).not.toBeNull();
    expect(notif!.deliveries.find((d) => d.channel === "IN_APP")?.status).toBe("SENT");
    expect(notif!.deliveries.find((d) => d.channel === "EMAIL")?.status).toBe("SKIPPED");

    const done = await completeOccurrence(mate.id, occ.id);
    expect(done.status).toBe("DONE");
    expect(done.completedById).toBe(mate.id);
    // Completing twice is a no-op, not a second history entry
    await completeOccurrence(owner.id, occ.id);
    const { occurrences } = await getTask(owner.id, task.id);
    expect(occurrences[0].events.map((e) => e.type)).toEqual(["assigned", "completed"]);
  });
});

describe("recurring task history", () => {
  async function weeklyChore() {
    const h = await makeHousehold(2);
    // Start a few weeks back so we have past + future occurrences. Backdate createdAt so past slots exist.
    const start = DateTime.now().setZone(TZ).minus({ weeks: 3 }).startOf("week").toISODate()!;
    const task = await createTask(h.owner.id, h.household.id, {
      title: "Clean bathroom", recurrence: "WEEKLY", weekdays: [1], startsOn: start, dueTime: "18:00",
      assignmentMode: "ROTATE", eligibleUserIds: h.members.map((m) => m.id), estimatedMinutes: 40,
    });
    await prisma.taskDefinition.update({ where: { id: task.id }, data: { createdAt: new Date(start) } });
    await ensureOccurrences(h.household.id);
    const occs = await prisma.taskOccurrence.findMany({ where: { definitionId: task.id }, orderBy: { sequence: "asc" } });
    return { ...h, task, occs };
  }

  it("keeps a separate row per week and rotates assignees deterministically", async () => {
    const { members, occs } = await weeklyChore();
    expect(occs.length).toBeGreaterThanOrEqual(6);
    expect(new Set(occs.map((o) => o.originalDueAt.toISOString())).size).toBe(occs.length);
    occs.slice(0, 6).forEach((o, i) => expect(o.assigneeId).toBe(members[i % 3].id));
  });

  it("completing one week does not affect other weeks; generation is idempotent", async () => {
    const { owner, household, occs } = await weeklyChore();
    await completeOccurrence(owner.id, occs[0].id);
    await skipOccurrence(owner.id, occs[1].id, "Away for the weekend");
    const before = await prisma.taskOccurrence.count({ where: { householdId: household.id } });
    await ensureOccurrences(household.id);
    await ensureOccurrences(household.id);
    expect(await prisma.taskOccurrence.count({ where: { householdId: household.id } })).toBe(before);
    const fresh = await prisma.taskOccurrence.findMany({ where: { id: { in: occs.slice(0, 3).map((o) => o.id) } }, orderBy: { sequence: "asc" } });
    expect(fresh.map((o) => o.status)).toEqual(["DONE", "SKIPPED", "PENDING"]);
    expect(fresh[1].skipReason).toBe("Away for the weekend");
  });

  it("editing the rule keeps history and manual changes but regenerates untouched future weeks", async () => {
    const { owner, household, task, occs, members } = await weeklyChore();
    const now = new Date();
    const past = occs.filter((o) => o.dueAt < now);
    const future = occs.filter((o) => o.dueAt >= now);
    await completeOccurrence(owner.id, past[0].id);
    // Someone manually reassigns one future week
    await assignOccurrence(owner.id, future[0].id, members[2].id);

    await updateTask(owner.id, task.id, {
      title: "Clean bathroom", recurrence: "WEEKLY", weekdays: [3], startsOn: task.startsOn, dueTime: "18:00",
      assignmentMode: "FIXED", assigneeId: members[1].id, estimatedMinutes: 40,
    });
    const after = await prisma.taskOccurrence.findMany({ where: { definitionId: task.id } });
    expect(after.find((o) => o.id === past[0].id)?.status).toBe("DONE");
    expect(after.find((o) => o.id === future[0].id)?.assigneeId).toBe(members[2].id);
    const regenerated = after.filter((o) => o.dueAt >= now && !o.manuallyChanged);
    expect(regenerated.length).toBeGreaterThan(0);
    for (const o of regenerated) {
      expect(DateTime.fromJSDate(o.dueAt).setZone(TZ).weekday).toBe(3);
      expect(o.assigneeId).toBe(members[1].id);
    }
    void household;
  });

  it("reschedule keeps the original slot; reopen restores pending", async () => {
    const { owner, occs } = await weeklyChore();
    const target = occs[occs.length - 1];
    const newDue = new Date(target.dueAt.getTime() + 2 * 86400_000);
    const moved = await rescheduleOccurrence(owner.id, target.id, newDue);
    expect(moved.dueAt.toISOString()).toBe(newDue.toISOString());
    expect(moved.originalDueAt.toISOString()).toBe(target.originalDueAt.toISOString());
    await completeOccurrence(owner.id, target.id);
    const reopened = await reopenOccurrence(owner.id, target.id);
    expect(reopened.status).toBe("PENDING");
    expect(reopened.completedById).toBeNull();
  });
});

describe("one-time tasks", () => {
  it("editing a one-time task moves its single occurrence instead of duplicating", async () => {
    const { owner, household } = await makeHousehold(0);
    const t = await createTask(owner.id, household.id, { title: "Buy bulbs", kind: "ERRAND", startsOn: "2031-05-01" });
    await updateTask(owner.id, t.id, { title: "Buy bulbs", kind: "ERRAND", startsOn: "2031-05-03", dueTime: "12:00" });
    const occs = await prisma.taskOccurrence.findMany({ where: { definitionId: t.id } });
    expect(occs).toHaveLength(1);
    expect(DateTime.fromJSDate(occs[0].dueAt).setZone(TZ).toFormat("yyyy-MM-dd HH:mm")).toBe("2031-05-03 12:00");
    void household;
  });
});
