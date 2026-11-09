import nodemailer from "nodemailer";
import { DateTime } from "luxon";
import { prisma } from "./db";
import { notify, emailConfigured } from "./notifications";
import { ensureOccurrences } from "./tasks";

export const DUE_SOON_MINUTES = 120;

/**
 * Generate reminder notifications. Idempotent via dedupe keys, so running it every few
 * minutes (or twice concurrently) never double-notifies.
 *  - due soon: pending, assigned, due within the next 2 hours (one per occurrence)
 *  - overdue: pending, assigned, past due (one per occurrence per local day, max 3 days)
 *  - planned: a task someone planned starts within 30 minutes
 */
export async function generateReminders(now = new Date()) {
  const households = await prisma.household.findMany({ select: { id: true, timezone: true } });
  let created = 0;
  for (const h of households) {
    await ensureOccurrences(h.id, now);
    const soon = new Date(now.getTime() + DUE_SOON_MINUTES * 60_000);
    const occs = await prisma.taskOccurrence.findMany({
      where: { householdId: h.id, status: "PENDING", assigneeId: { not: null }, dueAt: { lt: soon, gt: new Date(now.getTime() - 3 * 86400_000) } },
      include: { definition: { select: { title: true } } },
    });
    for (const o of occs) {
      const due = DateTime.fromJSDate(o.dueAt).setZone(h.timezone);
      const r = o.dueAt > now
        ? await notify({
            userId: o.assigneeId!, householdId: h.id, type: "task_due_soon",
            title: `Due soon: ${o.definition.title}`, body: `Due ${due.toFormat("h:mm a")}`,
            link: `/tasks/${o.definitionId}`, dedupeKey: `due_soon:${o.id}`,
          })
        : await notify({
            userId: o.assigneeId!, householdId: h.id, type: "task_overdue",
            title: `Overdue: ${o.definition.title}`, body: `Was due ${due.toFormat("ccc h:mm a")}. Mark it done, skip it, or pick a new time in the planner.`,
            link: `/planner#missed`, dedupeKey: `overdue:${o.id}:${DateTime.fromJSDate(now).setZone(h.timezone).toISODate()}`,
          });
      if (r) created++;
    }
    const planned = await prisma.taskOccurrence.findMany({
      where: { householdId: h.id, status: "PENDING", assigneeId: { not: null }, scheduledStart: { gt: now, lt: new Date(now.getTime() + 30 * 60_000) } },
      include: { definition: { select: { title: true } } },
    });
    for (const o of planned) {
      const r = await notify({
        userId: o.assigneeId!, householdId: h.id, type: "task_planned_start",
        title: `Coming up: ${o.definition.title}`, body: `Planned for ${DateTime.fromJSDate(o.scheduledStart!).setZone(h.timezone).toFormat("h:mm a")}`,
        link: `/tasks/${o.definitionId}`, dedupeKey: `planned:${o.id}:${o.scheduledStart!.getTime()}`,
      });
      if (r) created++;
    }
  }
  return created;
}

export type Mailer = { sendMail: (m: { from: string; to: string; subject: string; text: string }) => Promise<unknown> };

export function defaultMailer(): Mailer | null {
  if (!emailConfigured()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

/** Send pending email deliveries. Each attempt is recorded; after 3 failures it stays FAILED. */
export async function deliverEmails(mailer: Mailer | null = defaultMailer()) {
  const pending = await prisma.notificationDelivery.findMany({
    where: { channel: "EMAIL", status: "PENDING", attempts: { lt: 3 } },
    include: { notification: { include: { user: true } } },
    take: 100,
  });
  let sent = 0;
  for (const d of pending) {
    if (!mailer) {
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: "SKIPPED", error: "SMTP not configured" } });
      continue;
    }
    const n = d.notification;
    try {
      await mailer.sendMail({
        from: process.env.SMTP_FROM || "RoomSync <no-reply@example.com>",
        to: n.user.email,
        subject: n.title,
        text: `${n.body ?? ""}\n\n${n.link ? `${process.env.APP_URL ?? ""}${n.link}` : ""}\n\nYou can turn off email reminders in RoomSync → Household → Your preferences.`,
      });
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: "SENT", attempts: { increment: 1 }, lastAttemptAt: new Date(), error: null } });
      sent++;
    } catch (e) {
      const attempts = d.attempts + 1;
      await prisma.notificationDelivery.update({
        where: { id: d.id },
        data: { attempts, lastAttemptAt: new Date(), error: (e as Error).message.slice(0, 300), status: attempts >= 3 ? "FAILED" : "PENDING" },
      });
    }
  }
  return sent;
}
