import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { makeHousehold } from "./helpers";
import { createInvitation, acceptInvitation, getHouseholdOverview, leaveHousehold } from "@/server/households";
import { createTask, completeOccurrence, ensureOccurrences, listOccurrences } from "@/server/tasks";
import { removeMember, setMemberRole } from "@/server/members";
import { prisma } from "@/server/db";

const today = () => DateTime.now().setZone("America/New_York").toISODate()!;

describe("member management", () => {
  it("only owners can remove or change roles, and never across households", async () => {
    const { household, owner, members: [, mate, other] } = await makeHousehold(2);
    const outside = await makeHousehold(1);
    await expect(removeMember(mate.id, household.id, other.id)).rejects.toThrow(/Only the household owner/);
    await expect(setMemberRole(mate.id, household.id, mate.id, "OWNER")).rejects.toThrow(/Only the household owner/);
    await expect(removeMember(outside.owner.id, household.id, mate.id)).rejects.toThrow(/not a member/);
    await expect(removeMember(owner.id, household.id, outside.members[1].id)).rejects.toThrow(/not found/);
    await expect(removeMember(owner.id, household.id, owner.id)).rejects.toThrow(/Leave household/);
  });

  it("removing a roommate releases their open work but keeps history", async () => {
    const { household, owner, members: [, mate, third] } = await makeHousehold(2);
    const fixed = await createTask(owner.id, household.id, {
      title: "Water plants", recurrence: "DAILY", startsOn: today(), assignmentMode: "FIXED", assigneeId: mate.id,
    });
    const rot2 = await createTask(owner.id, household.id, {
      title: "Trash", recurrence: "DAILY", startsOn: today(), assignmentMode: "ROTATE", eligibleUserIds: [owner.id, mate.id],
    });
    const rot3 = await createTask(owner.id, household.id, {
      title: "Dishes", recurrence: "DAILY", startsOn: today(), assignmentMode: "ROTATE", eligibleUserIds: [owner.id, mate.id, third.id],
    });
    await ensureOccurrences(household.id);
    const mine = await listOccurrences(mate.id, household.id, { status: "PENDING", assigneeId: mate.id });
    expect(mine.length).toBeGreaterThan(2);
    await completeOccurrence(mate.id, mine[0].id);

    const r = await removeMember(owner.id, household.id, mate.id);
    expect(r.releasedOccurrences).toBe(mine.length - 1);

    // History kept, open work unassigned.
    const done = await prisma.taskOccurrence.findUniqueOrThrow({ where: { id: mine[0].id } });
    expect(done).toMatchObject({ status: "DONE", assigneeId: mate.id, completedById: mate.id });
    expect(await prisma.taskOccurrence.count({ where: { householdId: household.id, assigneeId: mate.id, status: "PENDING" } })).toBe(0);

    // Rules no longer point at them.
    const defs = await prisma.taskDefinition.findMany({ where: { id: { in: [fixed.id, rot2.id, rot3.id] } } });
    const byId = new Map(defs.map((d) => [d.id, d]));
    expect(byId.get(fixed.id)).toMatchObject({ assignmentMode: "UNASSIGNED", assigneeId: null });
    expect(byId.get(rot2.id)).toMatchObject({ assignmentMode: "FIXED", assigneeId: owner.id, eligibleUserIds: [owner.id] });
    expect(byId.get(rot3.id)).toMatchObject({ assignmentMode: "ROTATE", eligibleUserIds: [owner.id, third.id] });

    // They lose access; remaining roommates are told; removed person is notified.
    await expect(getHouseholdOverview(mate.id, household.id)).rejects.toThrow(/not a member/);
    expect(await prisma.notification.count({ where: { userId: mate.id, type: "member_removed" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: third.id, type: "tasks_released" } })).toBe(1);

    // Newly generated occurrences never go to the removed member.
    await ensureOccurrences(household.id, DateTime.now().plus({ days: 10 }).toJSDate());
    expect(await prisma.taskOccurrence.count({ where: { householdId: household.id, assigneeId: mate.id, status: "PENDING" } })).toBe(0);
  });

  it("keeps at least one owner and lets an owner leave after handing over", async () => {
    const { household, owner, members: [, mate] } = await makeHousehold(1);
    await expect(setMemberRole(owner.id, household.id, owner.id, "MEMBER")).rejects.toThrow(/at least one owner/);
    await expect(leaveHousehold(owner.id, household.id)).rejects.toThrow(/another roommate an owner/);
    await setMemberRole(owner.id, household.id, mate.id, "OWNER");
    expect(await prisma.notification.count({ where: { userId: mate.id, type: "role_changed" } })).toBe(1);
    await leaveHousehold(owner.id, household.id);
    const overview = await getHouseholdOverview(mate.id, household.id);
    expect(overview.members.map((m) => m.id)).toEqual([mate.id]);
    expect(overview.role).toBe("OWNER");
  });

  it("a former owner who rejoins comes back as a regular member", async () => {
    const { household, owner, members: [, mate] } = await makeHousehold(1);
    await setMemberRole(owner.id, household.id, mate.id, "OWNER");
    await leaveHousehold(mate.id, household.id);
    const inv = await createInvitation(owner.id, household.id);
    await acceptInvitation(mate.id, inv.code);
    expect((await getHouseholdOverview(mate.id, household.id)).role).toBe("MEMBER");
  });

  it("leaving releases your open tasks too", async () => {
    const { household, owner, members: [, mate] } = await makeHousehold(1);
    await createTask(owner.id, household.id, { title: "Vacuum", startsOn: today(), assignmentMode: "FIXED", assigneeId: mate.id });
    await leaveHousehold(mate.id, household.id);
    const open = await prisma.taskOccurrence.findMany({ where: { householdId: household.id, status: "PENDING" } });
    expect(open.every((o) => o.assigneeId === null)).toBe(true);
    expect(await prisma.notification.count({ where: { userId: owner.id, type: "tasks_released" } })).toBe(1);
  });
});
