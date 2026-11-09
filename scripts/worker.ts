/**
 * Background worker: adds recurring bills, generates reminders and weekly recaps, and delivers emails.
 * Run alongside the web app:  npm run worker
 * Or as a cron job:            npm run worker -- --once
 */
import "dotenv/config";
import { prisma } from "../src/server/db";
import { runBackgroundJobs } from "../src/server/jobs";

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS || 5 * 60_000);

async function tick() {
  const started = Date.now();
  try {
    const r = await runBackgroundJobs();
    console.log(`[worker] ${new Date().toISOString()} bills_added=${r.billsAdded} reminders=${r.reminders} recaps=${r.recaps} emails_sent=${r.emailsSent} (${Date.now() - started}ms)`);
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
