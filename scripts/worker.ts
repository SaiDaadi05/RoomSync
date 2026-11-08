/**
 * Background worker: adds recurring bills, generates reminders, and delivers emails.
 * Run alongside the web app:  npm run worker
 * Or as a cron job:            npm run worker -- --once
 */
import "dotenv/config";
import { generateReminders, deliverEmails } from "../src/server/reminders";
import { prisma } from "../src/server/db";
import { ensureAllBillExpenses } from "../src/server/bills";

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS || 5 * 60_000);

async function tick() {
  const started = Date.now();
  try {
    const bills = await ensureAllBillExpenses();
    const created = await generateReminders();
    const sent = await deliverEmails();
    console.log(`[worker] ${new Date().toISOString()} bills_added=${bills} reminders=${created} emails_sent=${sent} (${Date.now() - started}ms)`);
  } catch (e) {
    console.error("[worker] tick failed", e);
  }
}

if (process.argv.includes("--once")) {
  tick().finally(() => prisma.$disconnect());
} else {
  console.log(`[worker] running every ${INTERVAL_MS / 1000}s`);
  tick();
  setInterval(tick, INTERVAL_MS);
}
