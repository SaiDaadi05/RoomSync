import webpush from "web-push";
import { z } from "zod";
import { prisma } from "./db";
import { invalid } from "./errors";

/** Web Push is off until VAPID keys are set (generate them with `npm run vapid`). */
export function pushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function vapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

const subSchema = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith("https://"), "Push endpoints must be https"),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});

/** Save this device for the signed-in user. Re-subscribing the same device just moves it to them. */
export async function savePushSubscription(userId: string, input: unknown, userAgent?: string | null) {
  if (!pushConfigured()) throw invalid("Phone notifications aren't set up on this server yet");
  const sub = subSchema.parse(input);
  const data = { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 200) ?? null, failures: 0 };
  return prisma.pushSubscription.upsert({ where: { endpoint: sub.endpoint }, create: { endpoint: sub.endpoint, ...data }, update: data });
}

/** Only ever removes the caller's own devices. */
export async function removePushSubscription(userId: string, endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

export async function countPushDevices(userId: string) {
  return prisma.pushSubscription.count({ where: { userId } });
}

export type PushSender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>;

function defaultSender(): PushSender | null {
  if (!pushConfigured()) return null;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || `mailto:${process.env.SMTP_FROM?.match(/<(.+)>/)?.[1] ?? "admin@example.com"}`, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  return (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 6 * 3600, urgency: "normal" });
}

/**
 * Send pending PUSH deliveries to every device of each recipient. A device the push service
 * says is gone (404/410) is deleted; other failures retry up to 3 times.
 */
export async function deliverPush(send: PushSender | null = defaultSender()) {
  const pending = await prisma.notificationDelivery.findMany({
    where: { channel: "PUSH", status: "PENDING", attempts: { lt: 3 } },
    include: { notification: true },
    take: 100,
  });
  let sent = 0;
  for (const d of pending) {
    if (!send) {
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: "SKIPPED", error: "Push not configured" } });
      continue;
    }
    const n = d.notification;
    const subs = await prisma.pushSubscription.findMany({ where: { userId: n.userId } });
    if (subs.length === 0) {
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: "SKIPPED", error: "No devices", lastAttemptAt: new Date() } });
      continue;
    }
    const payload = JSON.stringify({ title: n.title, body: n.body ?? "", link: n.link ?? "/notifications", tag: n.id });
    let ok = 0;
    let lastError = "";
    for (const s of subs) {
      try {
        await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        ok++;
        await prisma.pushSubscription.update({ where: { id: s.id }, data: { lastSuccessAt: new Date(), failures: 0 } });
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        lastError = `${status ?? ""} ${(e as Error).message}`.trim().slice(0, 300);
        if (status === 404 || status === 410) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
        else await prisma.pushSubscription.update({ where: { id: s.id }, data: { failures: { increment: 1 } } });
      }
    }
    const attempts = d.attempts + 1;
    await prisma.notificationDelivery.update({
      where: { id: d.id },
      data: ok > 0
        ? { status: "SENT", attempts, lastAttemptAt: new Date(), error: null }
        : { status: attempts >= 3 ? "FAILED" : "PENDING", attempts, lastAttemptAt: new Date(), error: lastError },
    });
    if (ok > 0) sent++;
  }
  return sent;
}
