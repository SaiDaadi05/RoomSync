import { describe, expect, it } from "vitest";
import { makeHousehold } from "./helpers";
import { createTask, nudgeOccurrence, assignOccurrence } from "@/server/tasks";
import { prisma } from "@/server/db";

async function overdueChore(assignee: string | null) {
  const h = await makeHousehold(2);
  const t = await createTask(h.owner.id, h.household.id, { title: "Clean bathroom", startsOn: "2026-03-01" });
  const occ = await prisma.taskOccurrence.findFirstOrThrow({ where: { definitionId: t.id } });
  await prisma.taskOccurrence.update({ where: { id: occ.id }, data: { dueAt: new Date(Date.now() - 86400_000), assigneeId: assignee === "mate" ? h.members[1].id : null } });
  return { ...h, occ };
}

describe("nudges", () => {
  it("notifies the assignee once per chore per day, whoever nudges", async () => {
    const { owner, members, occ } = await overdueChore("mate");
    const [, mate, third] = members;
    expect(await nudgeOccurrence(owner.id, occ.id)).toMatchObject({ sent: true });
    expect(await nudgeOccurrence(third.id, occ.id)).toMatchObject({ sent: false });
    const notes = await prisma.notification.findMany({ where: { userId: mate.id, type: "task_nudge" } });
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toMatch(/nudged you: Clean bathroom/);
    expect(await prisma.taskEvent.count({ where: { occurrenceId: occ.id, type: "nudged" } })).toBe(1);
    // Next day it's allowed again.
    expect(await nudgeOccurrence(owner.id, occ.id, new Date(Date.now() + 86400_000))).toMatchObject({ sent: true });
  });

  it("refuses nudges that don't make sense", async () => {
    const { owner, members, occ } = await overdueChore("mate");
    await expect(nudgeOccurrence(members[1].id, occ.id)).rejects.toThrow(/yours/);
    await prisma.taskOccurrence.update({ where: { id: occ.id }, data: { dueAt: new Date(Date.now() + 3600_000) } });
    await expect(nudgeOccurrence(owner.id, occ.id)).rejects.toThrow(/overdue/);
    await assignOccurrence(owner.id, occ.id, null);
    await prisma.taskOccurrence.update({ where: { id: occ.id }, data: { dueAt: new Date(Date.now() - 3600_000) } });
    await expect(nudgeOccurrence(owner.id, occ.id)).rejects.toThrow(/Nobody is assigned/);
  });

  it("can't be used across households", async () => {
    const { occ, members } = await overdueChore("mate");
    const other = await makeHousehold(0, "Other");
    await expect(nudgeOccurrence(other.owner.id, occ.id)).rejects.toThrow();
    expect(await prisma.notification.count({ where: { type: "task_nudge", userId: members[1].id } })).toBe(0);
  });
});
