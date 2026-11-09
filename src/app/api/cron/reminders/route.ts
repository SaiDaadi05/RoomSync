import crypto from "node:crypto";
import { generateReminders, deliverEmails } from "@/server/reminders";

/**
 * Serverless version of `npm run worker -- --once`, for hosts without a long-running process.
 * Called by Vercel Cron (which sends `Authorization: Bearer $CRON_SECRET`) and by the
 * scheduled GitHub Actions workflow. Reminder generation is idempotent, so overlapping or
 * repeated calls are safe.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // never run unauthenticated
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  const started = Date.now();
  const reminders = await generateReminders();
  const emailsSent = await deliverEmails();
  return Response.json({ reminders, emailsSent, ms: Date.now() - started });
}
