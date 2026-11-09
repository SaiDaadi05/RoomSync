import { generateReminders, deliverEmails } from "./reminders";
import { generateWeeklyRecaps } from "./recap";
import { ensureAllBillExpenses } from "./bills";
import { deliverPush } from "./push";
import { prisma } from "./db";

/**
 * One background tick. Shared by the long-running worker and the serverless cron route so
 * the two can't drift apart. Every step is idempotent, so overlapping runs are safe.
 */
export async function runBackgroundJobs(now = new Date()) {
  const billsAdded = await ensureAllBillExpenses(now);
  const reminders = await generateReminders(now);
  const recaps = await generateWeeklyRecaps(now);
  const emailsSent = await deliverEmails();
  const pushesSent = await deliverPush();
  await cleanUp(now);
  return { billsAdded, reminders, recaps, emailsSent, pushesSent };
}

/** Drop expired sessions, old reset links and old failed-login records. */
export async function cleanUp(now = new Date()) {
  const dayAgo = new Date(now.getTime() - 24 * 3600_000);
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.passwordReset.deleteMany({ where: { OR: [{ expiresAt: { lt: dayAgo } }, { usedAt: { lt: dayAgo } }] } }),
    prisma.loginFailure.deleteMany({ where: { createdAt: { lt: dayAgo } } }),
  ]);
}
