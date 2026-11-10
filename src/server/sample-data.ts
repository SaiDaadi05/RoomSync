import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { DateTime } from "luxon";
import { prisma } from "./db";
import { createHousehold } from "./households";
import { createTask, ensureOccurrences } from "./tasks";
import { addShoppingItem, claimShoppingItem, markPurchased, purchaseWithExpense } from "./shopping";
import { createExpense, recordSettlement } from "./expenses";

type SampleOptions = { isDemo: boolean; emailDomain: string; password?: string; householdName?: string; timezone?: string };

/**
 * Build a realistic household: 3 roommates, recurring chores with some history,
 * a shopping list, expenses with balances, and weekly availability.
 * Used by `npm run db:seed` (real-looking dev data) and by demo mode (isDemo = true).
 */
export async function createSampleHousehold(opts: SampleOptions) {
  const tz = opts.timezone ?? "America/New_York";
  const tag = crypto.randomBytes(4).toString("hex");
  const passwordHash = await bcrypt.hash(opts.password ?? crypto.randomBytes(16).toString("hex"), 10);
  const people = [
    { name: "Alex Rivera", key: "alex" },
    { name: "Jordan Lee", key: "jordan" },
    { name: "Sam Patel", key: "sam" },
  ];
  const users = [];
  for (const p of people) {
    users.push(
      await prisma.user.create({
        data: {
          name: p.name,
          email: opts.isDemo ? `${p.key}-${tag}@${opts.emailDomain}` : `${p.key}@${opts.emailDomain}`,
          passwordHash,
          timezone: tz,
          isDemo: opts.isDemo,
        },
      }),
    );
  }
  const [alex, jordan, sam] = users;
  const household = await createHousehold(alex.id, { name: opts.householdName ?? "Maple St. Apartment", timezone: tz }, { isDemo: opts.isDemo });
  await prisma.membership.createMany({ data: [jordan, sam].map((u) => ({ householdId: household.id, userId: u.id, role: "MEMBER" as const })) });

  const now = DateTime.now().setZone(tz);
  const threeWeeksAgo = now.minus({ weeks: 3 }).startOf("week").toISODate()!;
  const all = users.map((u) => u.id);

  const chores = [
    { title: "Take out trash & recycling", category: "trash", estimatedMinutes: 10, recurrence: "WEEKLY", weekdays: [2, 5], dueTime: "21:00", assignmentMode: "ROTATE", eligibleUserIds: all },
    { title: "Clean the bathroom", category: "bathroom", estimatedMinutes: 45, recurrence: "WEEKLY", weekdays: [6], dueTime: "18:00", assignmentMode: "ROTATE", eligibleUserIds: all },
    { title: "Vacuum common areas", category: "cleaning", estimatedMinutes: 25, recurrence: "WEEKLY", weekdays: [7], dueTime: "18:00", assignmentMode: "ROTATE", eligibleUserIds: [jordan.id, sam.id] },
    { title: "Run & empty the dishwasher", category: "kitchen", estimatedMinutes: 15, recurrence: "DAILY", weekdays: [], dueTime: "21:30", assignmentMode: "UNASSIGNED", eligibleUserIds: [] },
    { title: "Water the plants", category: "other", estimatedMinutes: 5, recurrence: "WEEKLY", weekdays: [1, 4], dueTime: "10:00", assignmentMode: "FIXED", assigneeId: sam.id, eligibleUserIds: [] },
  ];
  const defs = [];
  for (const c of chores) defs.push(await createTask(alex.id, household.id, { ...c, startsOn: threeWeeksAgo }));
  // Backdate creation so past occurrences exist, then build some history.
  await prisma.taskDefinition.updateMany({ where: { householdId: household.id }, data: { createdAt: new Date(threeWeeksAgo) } });
  await ensureOccurrences(household.id);
  const past = await prisma.taskOccurrence.findMany({ where: { householdId: household.id, dueAt: { lt: now.minus({ days: 1 }).toJSDate() } }, orderBy: { dueAt: "asc" } });
  // Mark most past chores done in bulk (a few hundred fewer round trips than one
  // completeOccurrence per chore, which made the demo button take seconds).
  const doneBy = new Map<string, string[]>();
  for (const [i, o] of past.entries()) {
    if (i % 7 === 6) continue; // leave a few overdue
    const who = o.assigneeId ?? all[i % 3]!;
    doneBy.set(who, [...(doneBy.get(who) ?? []), o.id]);
  }
  const doneIds = [...doneBy.values()].flat();
  await prisma.$transaction([
    ...[...doneBy].map(([who, ids]) =>
      prisma.taskOccurrence.updateMany({ where: { id: { in: ids } }, data: { status: "DONE", completedById: who } }),
    ),
    prisma.$executeRaw`UPDATE "TaskOccurrence" SET "completedAt" = "dueAt" - interval '1 hour' WHERE id = ANY(${doneIds})`,
    prisma.taskEvent.createMany({
      data: past.filter((o) => doneIds.includes(o.id)).map((o) => ({
        occurrenceId: o.id,
        actorId: [...doneBy].find(([, ids]) => ids.includes(o.id))![0],
        type: "completed",
        data: { forAssignee: o.assigneeId },
        createdAt: new Date(o.dueAt.getTime() - 3600_000),
      })),
    }),
  ]);

  await createTask(jordan.id, household.id, {
    title: "Drop off package at UPS", kind: "ERRAND", category: "errands", estimatedMinutes: 20,
    startsOn: now.plus({ days: 1 }).toISODate()!, dueTime: "17:00", assignmentMode: "FIXED", assigneeId: jordan.id,
  });

  // Shopping
  const items = [
    { name: "Paper towels", quantity: "1 pack" },
    { name: "Dish soap", quantity: "1" },
    { name: "Oat milk", quantity: "2", notes: "The unsweetened one" },
    { name: "Trash bags (13 gal)", quantity: "1 box", productUrl: "https://www.amazon.com/s?k=13+gallon+trash+bags" },
    { name: "Coffee beans", quantity: "1 bag" },
  ];
  const created = [];
  for (const it of items) created.push(await addShoppingItem(alex.id, household.id, it));
  await claimShoppingItem(sam.id, created[4].id);

  // Expenses
  const d = (days: number) => now.minus({ days }).toISODate()!;
  await createExpense(alex.id, household.id, { payerId: alex.id, amountCents: 8743, date: d(12), description: "Costco run", category: "groceries", splitMethod: "EQUAL", participants: all.map((userId) => ({ userId })) });
  await createExpense(jordan.id, household.id, { payerId: jordan.id, amountCents: 6000, date: d(9), description: "Internet (November)", category: "internet", splitMethod: "EQUAL", participants: all.map((userId) => ({ userId })) });
  await createExpense(sam.id, household.id, {
    payerId: sam.id, amountCents: 14250, date: d(6), description: "Electric bill", category: "utilities", splitMethod: "CUSTOM",
    participants: [{ userId: alex.id, amountCents: 5250 }, { userId: jordan.id, amountCents: 4500 }, { userId: sam.id, amountCents: 4500 }],
  });
  const boughtItem = await addShoppingItem(jordan.id, household.id, { name: "Sponges" });
  await purchaseWithExpense(jordan.id, household.id, { itemIds: [boughtItem.id], amountCents: 499, date: d(3), participantIds: all });
  // A little purchase history, so "Running low?" has staples to suggest.
  for (const [name, buyer] of [["Toilet paper", sam], ["Eggs", alex], ["Toilet paper", jordan], ["Eggs", sam], ["Sponges", alex]] as const) {
    const it = await addShoppingItem(buyer.id, household.id, { name });
    await markPurchased(buyer.id, [it.id]);
  }
  await recordSettlement(sam.id, household.id, { fromUserId: sam.id, toUserId: alex.id, amountCents: 2000, date: d(2), note: "Venmo" });

  // Availability (manual, weekly): weekday evenings + weekend afternoons, slightly different per person
  const windows = [
    { u: alex, days: [1, 2, 3, 4], start: 18 * 60, end: 21 * 60 },
    { u: alex, days: [6, 7], start: 13 * 60, end: 17 * 60 },
    { u: jordan, days: [1, 3, 5], start: 17 * 60, end: 20 * 60 },
    { u: jordan, days: [6], start: 10 * 60, end: 14 * 60 },
    { u: sam, days: [2, 4], start: 19 * 60, end: 22 * 60 },
    { u: sam, days: [7], start: 11 * 60, end: 16 * 60 },
  ];
  await prisma.availabilityWindow.createMany({
    data: windows.flatMap((w) => w.days.map((weekday) => ({ userId: w.u.id, weekday, startMin: w.start, endMin: w.end }))),
  });

  return { household, users };
}
