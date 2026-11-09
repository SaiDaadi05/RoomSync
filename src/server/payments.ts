import { DateTime } from "luxon";
import { prisma } from "./db";
import { computeBalances } from "./expenses";
import { notify } from "./notifications";
import { formatCents } from "@/lib/money";
import { invalid } from "./errors";
import { cleanHandle } from "@/lib/pay-links";

const FIELDS = { venmoHandle: "Venmo", paypalHandle: "PayPal.me", cashtag: "Cash App" } as const;
type Field = keyof typeof FIELDS;

/** Save (or clear) the user's own pay handles. Blank clears a handle. */
export async function updatePayHandles(userId: string, input: Partial<Record<Field, unknown>>) {
  const data: Partial<Record<Field, string | null>> = {};
  for (const key of Object.keys(FIELDS) as Field[]) {
    const raw = typeof input[key] === "string" ? (input[key] as string).trim() : "";
    const clean = cleanHandle(raw);
    if (raw && !clean) throw invalid(`That ${FIELDS[key]} name doesn't look right. Use just the username, like alex-rivera.`);
    data[key] = clean;
  }
  return prisma.user.update({ where: { id: userId }, data, select: { venmoHandle: true, paypalHandle: true, cashtag: true } });
}

/** Handles of the given users. Callers must only pass members of the viewer's household. */
export async function getPayHandles(userIds: string[]) {
  const rows = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, venmoHandle: true, paypalHandle: true, cashtag: true } });
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Remind someone who owes you, at most once per person per week (ISO week, household time).
 * Only allowed when the household's suggested payments include them paying you.
 * Returns sent: false if a reminder already went out this week.
 */
export async function remindToSettle(userId: string, householdId: string, debtorId: string, now = new Date()) {
  const { balances, suggestions } = await computeBalances(userId, householdId);
  const owed = suggestions.find((s) => s.fromUserId === debtorId && s.toUserId === userId);
  if (!owed) throw invalid("They don't owe you anything right now");
  const debtor = balances.find((b) => b.userId === debtorId);
  if (!debtor?.active) throw invalid("They've moved out of the household, so they won't see a reminder here.");
  const me = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  const household = await prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { timezone: true, currency: true } });
  const week = DateTime.fromJSDate(now).setZone(household.timezone).toFormat("kkkk-'W'WW");
  const dedupeKey = `settle_reminder:${householdId}:${userId}:${debtorId}:${week}`;
  if (await prisma.notification.findUnique({ where: { dedupeKey } })) return { sent: false, name: debtor.name };
  const n = await notify({
    userId: debtorId, householdId, type: "settle_reminder",
    title: `${me.name.split(" ")[0]} asked you to settle up: ${formatCents(owed.amountCents, household.currency)}`,
    body: "Pay them however you normally do, then tap Record on the Expenses page.",
    link: "/expenses", dedupeKey,
  });
  return { sent: !!n, name: debtor.name };
}
