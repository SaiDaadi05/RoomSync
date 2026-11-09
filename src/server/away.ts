import { z } from "zod";
import { DateTime } from "luxon";
import { prisma } from "./db";
import { requireMember } from "./access";
import { invalid } from "./errors";
import { notify } from "./notifications";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const awaySchema = z.object({ from: dateStr, until: dateStr, release: z.boolean().default(true) });

/**
 * "I'm away": new chore slots in the window aren't assigned to me, the planner treats me as
 * busy, and nobody can nudge me. Optionally my already-assigned chores in the window go up
 * for grabs, and roommates are told. Nothing gets pushed onto anyone without them claiming it.
 */
export async function setAway(userId: string, householdId: string, input: unknown) {
  const m = await requireMember(userId, householdId);
  const { from, until, release } = awaySchema.parse(input);
  const tz = m.household.timezone;
  const today = DateTime.now().setZone(tz).toISODate()!;
  if (until < from) throw invalid("The end date has to be on or after the start date");
  if (until < today) throw invalid("Those dates are already over");
  if (DateTime.fromISO(until).diff(DateTime.fromISO(from), "days").days > 90) throw invalid("Away mode can be up to 90 days at a time");

  const start = DateTime.fromISO(from, { zone: tz }).startOf("day").toJSDate();
  const end = DateTime.fromISO(until, { zone: tz }).endOf("day").toJSDate();
  const released = await prisma.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: m.id }, data: { awayFrom: from, awayUntil: until } });
    if (!release) return [];
    const mine = await tx.taskOccurrence.findMany({
      where: { householdId, assigneeId: userId, status: "PENDING", dueAt: { gte: start, lte: end } },
      select: { id: true, definition: { select: { title: true } } },
    });
    if (mine.length) {
      await tx.taskOccurrence.updateMany({ where: { id: { in: mine.map((o) => o.id) } }, data: { assigneeId: null } });
      await tx.taskEvent.createMany({ data: mine.map((o) => ({ occurrenceId: o.id, actorId: userId, type: "released", data: { reason: "away" } })) });
    }
    return mine;
  });

  const me = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  const others = await prisma.membership.findMany({ where: { householdId, leftAt: null, userId: { not: userId } }, select: { userId: true } });
  const range = `${DateTime.fromISO(from).toFormat("ccc LLL d")} to ${DateTime.fromISO(until).toFormat("ccc LLL d")}`;
  const titles = [...new Set(released.map((o) => o.definition.title))];
  for (const o of others) {
    await notify({
      userId: o.userId, householdId, type: "member_away",
      title: `${me.name.split(" ")[0]} is away ${range}`,
      body: released.length ? `${released.length} of their chores are up for grabs: ${titles.slice(0, 4).join(", ")}${titles.length > 4 ? "…" : ""}.` : "Their chores in that time were already sorted.",
      link: "/home",
      dedupeKey: `away:${householdId}:${userId}:${from}:${until}`,
    });
  }
  return { released: released.length };
}

export async function clearAway(userId: string, householdId: string) {
  const m = await requireMember(userId, householdId);
  await prisma.membership.update({ where: { id: m.id }, data: { awayFrom: null, awayUntil: null } });
}
