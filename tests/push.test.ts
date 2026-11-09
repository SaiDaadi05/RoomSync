import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import webpush from "web-push";
// @ts-expect-error no types; it's web-push's own encryption dependency
import ece from "http_ece";
import { makeHousehold, makeUser } from "./helpers";
import { prisma } from "@/server/db";
import { notify } from "@/server/notifications";
import { deliverPush, removePushSubscription, savePushSubscription, type PushSender } from "@/server/push";

const b64u = (b: Buffer) => b.toString("base64url");

/** A fake browser: a real P-256 key pair and auth secret, like PushManager.subscribe() returns. */
function fakeDevice(n = 1) {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, sub: { endpoint: `https://push.example.test/send/${n}-${crypto.randomUUID()}`, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } } };
}

beforeEach(() => {
  const k = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = k.publicKey;
  process.env.VAPID_PRIVATE_KEY = k.privateKey;
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
});
afterEach(() => { delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; });

describe("web push", () => {
  it("encrypts so only the device can read it, with a VAPID signature", () => {
    const d = fakeDevice();
    const req = webpush.generateRequestDetails(d.sub, JSON.stringify({ title: "Trash tonight" }), {
      vapidDetails: { subject: "mailto:test@example.com", publicKey: process.env.VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY! },
    });
    expect(req.headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect(req.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(req.body.toString()).not.toContain("Trash");
    const plain = ece.decrypt(req.body, { version: "aes128gcm", privateKey: d.ecdh, authSecret: b64u(d.auth) });
    expect(JSON.parse(plain.toString())).toEqual({ title: "Trash tonight" });
  });

  it("queues push only for people with a device, and sends to every device", async () => {
    const { household, owner, members } = await makeHousehold(1);
    const mate = members[1]!;
    const a = fakeDevice(1), b = fakeDevice(2);
    await savePushSubscription(owner.id, a.sub);
    await savePushSubscription(owner.id, b.sub);
    await notify({ userId: owner.id, householdId: household.id, type: "t", title: "Owner note", dedupeKey: "k1" });
    await notify({ userId: mate.id, householdId: household.id, type: "t", title: "Mate note", dedupeKey: "k2" });
    const ds = await prisma.notificationDelivery.findMany({ where: { channel: "PUSH" }, include: { notification: true } });
    expect(ds.find((d) => d.notification.userId === owner.id)!.status).toBe("PENDING");
    expect(ds.find((d) => d.notification.userId === mate.id)).toMatchObject({ status: "SKIPPED", error: "No devices" });

    const got: { endpoint: string; payload: string }[] = [];
    const send: PushSender = async (sub, payload) => { got.push({ endpoint: sub.endpoint, payload }); };
    expect(await deliverPush(send)).toBe(1);
    expect(got.map((g) => g.endpoint).sort()).toEqual([a.sub.endpoint, b.sub.endpoint].sort());
    expect(JSON.parse(got[0]!.payload)).toMatchObject({ title: "Owner note", link: "/notifications" });
    expect((await prisma.notificationDelivery.findFirstOrThrow({ where: { channel: "PUSH", notification: { userId: owner.id } } })).status).toBe("SENT");
    expect(await deliverPush(send)).toBe(0); // nothing re-sent
  });

  it("drops devices the push service says are gone, and retries other failures", async () => {
    const u = await makeUser("P");
    const gone = fakeDevice(1), flaky = fakeDevice(2);
    await savePushSubscription(u.id, gone.sub);
    await savePushSubscription(u.id, flaky.sub);
    await notify({ userId: u.id, type: "t", title: "Hi", dedupeKey: "k3" });
    const send: PushSender = async (sub) => {
      const err = Object.assign(new Error(sub.endpoint === gone.sub.endpoint ? "Gone" : "Server error"), { statusCode: sub.endpoint === gone.sub.endpoint ? 410 : 500 });
      throw err;
    };
    expect(await deliverPush(send)).toBe(0);
    expect(await prisma.pushSubscription.count({ where: { userId: u.id } })).toBe(1);
    const d = await prisma.notificationDelivery.findFirstOrThrow({ where: { channel: "PUSH" } });
    expect(d).toMatchObject({ status: "PENDING", attempts: 1 });
    await deliverPush(send);
    await deliverPush(send);
    expect((await prisma.notificationDelivery.findFirstOrThrow({ where: { channel: "PUSH" } })).status).toBe("FAILED");
  });

  it("skips cleanly when push isn't configured", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    const u = await makeUser("Q");
    await notify({ userId: u.id, type: "t", title: "Hi", dedupeKey: "k4" });
    expect(await prisma.notificationDelivery.findFirstOrThrow({ where: { channel: "PUSH" } })).toMatchObject({ status: "SKIPPED", error: "Push not configured" });
    await expect(savePushSubscription(u.id, fakeDevice().sub)).rejects.toThrow(/aren't set up/);
  });

  it("validates subscriptions and only removes your own", async () => {
    const a = await makeUser("A"), b = await makeUser("B");
    await expect(savePushSubscription(a.id, { endpoint: "http://insecure.test/x", keys: fakeDevice().sub.keys })).rejects.toThrow();
    const d = fakeDevice();
    await savePushSubscription(a.id, d.sub);
    await removePushSubscription(b.id, d.sub.endpoint);
    expect(await prisma.pushSubscription.count()).toBe(1);
    await removePushSubscription(a.id, d.sub.endpoint);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });
});
