import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { makeHousehold } from "./helpers";
import { createTask, completeOccurrence } from "@/server/tasks";
import { cancelHandoff, createHandoff, listMyHandoffs, rebalanceSuggestions, respondHandoff } from "@/server/handoffs";
import { weekBounds } from "@/server/planner";
import { prisma } from "@/server/db";

const TZ = "America/New_York";
const tomorrow = () => DateTime.now().setZone(TZ).plus({ days: 1 }).toISODate()!;

async function assignedTask(householdId: string, creatorId: string, assigneeId: string, title = "Vacuum", minutes = 30) {
  const def = await createTask(creatorId, householdId, { title, startsOn: tomorrow(), assignmentMode: "FIXED", assigneeId, estimatedMinutes: minutes });
  return prisma.taskOccurrence.findFirstOrThrow({ where: { definitionId: def.id } });
}

describe("handoffs", () => {
  it("moves a task only after the other person accepts, and notifies both", async () => {
    const { household, owner, members: [, mate] } = await makeHousehold(1);
    const occ = await assignedTask(household.id, owner.id, owner.id);
    const h = await createHandoff(owner.id, { occurrenceId: occ.id, toUserId: mate.id, message: "Exam week" });

    expect((await prisma.taskOccurrence.findUniqueOrThrow({ where: { id: occ.id } })).assigneeId).toBe(owner.id);
    expect(await prisma.notification.count({ where: { userId: mate.id, type: "handoff_requested" } })).toBe(1);
    const incoming = await listMyHandoffs(mate.id, household.id);
    expect(incoming).toMatchObject([{ id: h.id, incoming: true, message: "Exam week" }]);

    // The requester can't answer their own request.
    await expect(respondHandoff(owner.id, h.id, true)).rejects.toThrow(/sent to/);
    await respondHandoff(mate.id, h.id, true);
    const after = await prisma.taskOccurrence.findUniqueOrThrow({ where: { id: occ.id } });
    expect(after).toMatchObject({ assigneeId: mate.id, manuallyChanged: true });
    expect(await prisma.taskEvent.count({ where: { occurrenceId: occ.id, type: "assigned" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: owner.id, type: "handoff_accepted" } })).toBe(1);
    await expect(respondHandoff(mate.id, h.id, true)).rejects.toThrow(/already answered/);
  });

  it("lets someone offer to take a task, and the assignee decides", async () => {
    const { household, owner, members: [, mate] } = await makeHousehold(1);
    const occ = await assignedTask(household.id, owner.id, owner.id);
    const h = await createHandoff(mate.id, { occurrenceId: occ.id, toUserId: mate.id });
    expect(h.fromUserId).toBe(owner.id);
    await respondHandoff(owner.id, h.id, false);
    expect((await prisma.taskOccurrence.findUniqueOrThrow({ where: { id: occ.id } })).assigneeId).toBe(owner.id);
    expect(await prisma.notification.count({ where: { userId: mate.id, type: "handoff_declined" } })).toBe(1);
  });

  it("never moves work between two other people or across households", async () => {
    const { household, owner, members: [, mate, third] } = await makeHousehold(2);
    const outside = await makeHousehold(1);
    const occ = await assignedTask(household.id, owner.id, mate.id);
    await expect(createHandoff(owner.id, { occurrenceId: occ.id, toUserId: third.id })).rejects.toThrow(/two other people/);
    await expect(createHandoff(outside.owner.id, { occurrenceId: occ.id, toUserId: outside.owner.id })).rejects.toThrow(/not a member/);
    await expect(createHandoff(mate.id, { occurrenceId: occ.id, toUserId: outside.owner.id })).rejects.toThrow(/member of this household/);
    const h = await createHandoff(mate.id, { occurrenceId: occ.id, toUserId: third.id });
    await expect(respondHandoff(outside.owner.id, h.id, true)).rejects.toThrow(/not a member/);
    await expect(createHandoff(mate.id, { occurrenceId: occ.id, toUserId: owner.id })).rejects.toThrow(/already a pending request/);
    await expect(cancelHandoff(third.id, h.id)).rejects.toThrow(/person who asked/);
    await cancelHandoff(mate.id, h.id);
    expect(await listMyHandoffs(third.id, household.id)).toEqual([]);
  });

  it("refuses to move a task that changed after the request was sent", async () => {
    const { household, owner, members: [, mate] } = await makeHousehold(1);
    const occ = await assignedTask(household.id, owner.id, owner.id);
    const h = await createHandoff(owner.id, { occurrenceId: occ.id, toUserId: mate.id });
    await completeOccurrence(owner.id, occ.id);
    expect(await listMyHandoffs(mate.id, household.id)).toEqual([]);
    await expect(respondHandoff(mate.id, h.id, true)).rejects.toThrow(/changed since/);
    const done = await prisma.taskOccurrence.findUniqueOrThrow({ where: { id: occ.id } });
    expect(done).toMatchObject({ status: "DONE", assigneeId: owner.id });
  });

  it("rebalance suggests moves but changes nothing, and skips pinned tasks", async () => {
    const { household, owner, members: [, mate] } = await makeHousehold(1);
    // Rotation task (movable) and a FIXED task (pinned) both on the owner.
    const rot = await createTask(owner.id, household.id, {
      title: "Deep clean", startsOn: tomorrow(), assignmentMode: "ROTATE", eligibleUserIds: [owner.id, mate.id], estimatedMinutes: 60,
    });
    const rotOcc = await prisma.taskOccurrence.findFirstOrThrow({ where: { definitionId: rot.id } });
    await prisma.taskOccurrence.update({ where: { id: rotOcc.id }, data: { assigneeId: owner.id } });
    await assignedTask(household.id, owner.id, owner.id, "Water my plants", 90);

    const tomorrowWeek = DateTime.now().setZone(TZ).plus({ days: 1 });
    const offset = Math.round(tomorrowWeek.startOf("week").diff(DateTime.now().setZone(TZ).startOf("week"), "weeks").weeks);
    const range = weekBounds(TZ, offset);
    const before = await prisma.taskOccurrence.findMany({ where: { householdId: household.id }, orderBy: { id: "asc" } });
    const moves = await rebalanceSuggestions(mate.id, household.id, { from: range.start, to: range.end });
    expect(moves.map((m) => [m.title, m.fromUserId, m.toUserId])).toEqual([["Deep clean", owner.id, mate.id]]);
    expect(await prisma.taskOccurrence.findMany({ where: { householdId: household.id }, orderBy: { id: "asc" } })).toEqual(before);

    // Once a request is pending for it, it isn't suggested again.
    await createHandoff(mate.id, { occurrenceId: moves[0].occurrenceId, toUserId: mate.id, source: "rebalance" });
    expect(await rebalanceSuggestions(mate.id, household.id, { from: range.start, to: range.end })).toEqual([]);
  });
});
