import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { makeHousehold } from "./helpers";
import { createTask } from "@/server/tasks";
import { createExpense } from "@/server/expenses";
import { generateWeeklyRecaps, recapSummary, recapWeekStart, weeklyRecap } from "@/server/recap";
import { prisma } from "@/server/db";

const TZ = "America/New_York";
const local = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();
// Sunday evening at the end of the week of Mon 2026-03-02.
const SUNDAY = local("2026-03-08T19:00");

async function chore(userId: string, householdId: string, title: string, minutes: number, dueIso: string, patch: Record<string, unknown>) {
  const t = await createTask(userId, householdId, { title, startsOn: "2026-03-01", estimatedMinutes: minutes });
  const occ = await prisma.taskOccurrence.findFirstOrThrow({ where: { definitionId: t.id } });
  await prisma.taskOccurrence.update({ where: { id: occ.id }, data: { dueAt: local(dueIso), ...patch } });
}

describe("weekly recap", () => {
  it("picks the right week", () => {
    expect(recapWeekStart(TZ, null, SUNDAY)).toBe("2026-03-02"); // Sunday → the week ending
    expect(recapWeekStart(TZ, null, local("2026-03-11T09:00"))).toBe("2026-03-02"); // Wednesday → last week
    expect(recapWeekStart(TZ, "2026-03-05", SUNDAY)).toBe("2026-03-02"); // snaps to Monday
    expect(recapWeekStart(TZ, "2027-01-01", SUNDAY)).toBe("2026-03-02"); // no future weeks
    expect(recapWeekStart(TZ, "nonsense", SUNDAY)).toBe("2026-03-02");
  });

  it("summarises chores, money and what's next, and notifies once per member", async () => {
    const { household, owner, members } = await makeHousehold(1);
    const mate = members[1];
    await chore(owner.id, household.id, "Vacuum", 30, "2026-03-03T20:00", { status: "DONE", completedById: mate.id, completedAt: local("2026-03-03T19:00"), assigneeId: mate.id });
    await chore(owner.id, household.id, "Dishes", 15, "2026-03-04T20:00", { status: "DONE", completedById: owner.id, completedAt: local("2026-03-04T19:00") });
    await chore(owner.id, household.id, "Bathroom", 40, "2026-03-05T20:00", { assigneeId: owner.id }); // missed
    await chore(owner.id, household.id, "Trash", 5, "2026-03-10T20:00", { assigneeId: owner.id }); // next week
    await chore(owner.id, household.id, "Old", 5, "2026-02-20T20:00", { status: "DONE", completedById: owner.id }); // other week
    await createExpense(owner.id, household.id, { payerId: owner.id, amountCents: 6000, date: "2026-03-04", description: "Groceries", category: "groceries", splitMethod: "EQUAL", participants: [{ userId: owner.id }, { userId: mate.id }] });
    await createExpense(owner.id, household.id, { payerId: owner.id, amountCents: 999, date: "2026-03-09", description: "Next week", category: "other", splitMethod: "EQUAL", participants: [{ userId: owner.id }] });

    const r = await weeklyRecap(owner.id, household.id, null, SUNDAY);
    expect(r.weekStart).toBe("2026-03-02");
    expect(r.chores.doneTotal).toBe(2);
    expect(r.chores.missedTotal).toBe(1);
    expect(r.chores.top?.userId).toBe(mate.id);
    expect(r.chores.people.find((p) => p.userId === owner.id)).toMatchObject({ done: 1, minutes: 15, missed: 1 });
    expect(r.money.spentCents).toBe(6000);
    expect(r.money.categories).toEqual([{ category: "groceries", cents: 6000 }]);
    expect(r.money.owes).toEqual([expect.objectContaining({ fromUserId: mate.id, toUserId: owner.id, amountCents: 3000 })]);
    expect(r.upcoming.map((u) => u.title)).toEqual(["Trash"]);
    expect(recapSummary(r, mate.id)).toBe("2 chores done (1 by you), you did the most, thank you, $60.00 spent, nothing assigned to you next week, you owe $30.00.");

    // Not yet Sunday evening → nothing; Sunday evening → one each; running again → no duplicates.
    await generateWeeklyRecaps(local("2026-03-08T12:00"));
    expect(await prisma.notification.count({ where: { householdId: household.id, type: "weekly_recap" } })).toBe(0);
    await generateWeeklyRecaps(SUNDAY);
    await generateWeeklyRecaps(local("2026-03-08T21:00"));
    const notes = await prisma.notification.findMany({ where: { householdId: household.id, type: "weekly_recap" } });
    expect(notes.map((n) => n.userId).sort()).toEqual([owner.id, mate.id].sort());
    expect(notes[0].link).toBe("/recap?week=2026-03-02");
  });

  it("only shows a household's own data to its members", async () => {
    const a = await makeHousehold(0, "A");
    const b = await makeHousehold(0, "B");
    await createExpense(b.owner.id, b.household.id, { payerId: b.owner.id, amountCents: 5000, date: "2026-03-04", description: "B stuff", category: "other", splitMethod: "EQUAL", participants: [{ userId: b.owner.id }] });
    const r = await weeklyRecap(a.owner.id, a.household.id, "2026-03-02", SUNDAY);
    expect(r.money.spentCents).toBe(0);
    await expect(weeklyRecap(a.owner.id, b.household.id, null, SUNDAY)).rejects.toThrow();
  });
});
