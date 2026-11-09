import { generateReminders, deliverEmails } from "./reminders";
import { generateWeeklyRecaps } from "./recap";
import { ensureAllBillExpenses } from "./bills";
import { deliverPush } from "./push";

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
  return { billsAdded, reminders, recaps, emailsSent, pushesSent };
}
