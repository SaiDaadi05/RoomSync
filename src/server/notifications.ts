import { prisma } from "./db";

export function emailConfigured() {
  return Boolean(process.env.SMTP_HOST);
}

type NotifyInput = {
  userId: string;
  householdId?: string | null;
  type: string;
  title: string;
  body?: string;
  link?: string;
  /** Same key = same notification; repeated calls are no-ops. */
  dedupeKey: string;
};

/**
 * Create a notification and its per-channel delivery records.
 *  - IN_APP is "SENT" as soon as the row exists (the app reads it), or SKIPPED if the user opted out.
 *  - EMAIL starts PENDING only if the user opted in AND SMTP is configured; the worker sends it.
 *    Otherwise it is recorded as SKIPPED with the reason, so nothing pretends an email went out.
 */
export async function notify(input: NotifyInput) {
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) return null;
  const existing = await prisma.notification.findUnique({ where: { dedupeKey: input.dedupeKey } });
  if (existing) return existing;
  const emailStatus = !user.notifyEmail ? "SKIPPED" : emailConfigured() ? "PENDING" : "SKIPPED";
  try {
    return await prisma.notification.create({
      data: {
        userId: input.userId,
        householdId: input.householdId ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link,
        dedupeKey: input.dedupeKey,
        deliveries: {
          create: [
            { channel: "IN_APP", status: user.notifyInApp ? "SENT" : "SKIPPED", lastAttemptAt: new Date() },
            {
              channel: "EMAIL",
              status: emailStatus,
              error: emailStatus === "SKIPPED" ? (user.notifyEmail ? "SMTP not configured" : "User opted out") : null,
            },
          ],
        },
      },
    });
  } catch (e: unknown) {
    // Unique violation from a concurrent call with the same dedupeKey — fine.
    if ((e as { code?: string }).code === "P2002") return null;
    throw e;
  }
}

export async function listInAppNotifications(userId: string, limit = 30) {
  return prisma.notification.findMany({
    where: { userId, deliveries: { some: { channel: "IN_APP", status: "SENT" } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({
    where: { userId, readAt: null, deliveries: { some: { channel: "IN_APP", status: "SENT" } } },
  });
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}
