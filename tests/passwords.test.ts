import { describe, expect, it } from "vitest";
import { makeUser } from "./helpers";
import { prisma } from "@/server/db";
import { createSession, getUserBySessionToken, verifyLogin } from "@/server/auth";
import { changePassword, checkResetToken, requestPasswordReset, resetPassword } from "@/server/passwords";
import type { Mailer } from "@/server/reminders";

function fakeMailer() {
  const sent: { to: string; subject: string; text: string }[] = [];
  const mailer: Mailer = { sendMail: async (m) => { sent.push(m); } };
  const tokenOf = (i = sent.length - 1) => sent[i]!.text.match(/token=([A-Za-z0-9_-]+)/)![1]!;
  return { mailer, sent, tokenOf };
}

describe("change password", () => {
  it("needs the current password and signs out other devices", async () => {
    const u = await makeUser("Pw");
    const here = await createSession(u.id);
    const phone = await createSession(u.id);
    await expect(changePassword(u.id, "wrong-one", "newpassword1", here.token)).rejects.toThrow(/current password is incorrect/);
    await expect(changePassword(u.id, "password123", "short", here.token)).rejects.toThrow(/at least 8/);
    await changePassword(u.id, "password123", "newpassword1", here.token);
    expect(await getUserBySessionToken(here.token)).not.toBeNull();
    expect(await getUserBySessionToken(phone.token)).toBeNull();
    await expect(verifyLogin(u.email, "password123")).rejects.toThrow();
    await expect(verifyLogin(u.email, "newpassword1")).resolves.toMatchObject({ id: u.id });
  });
});

describe("password reset", () => {
  it("emails a one-time link that sets a new password and signs out everywhere", async () => {
    const u = await makeUser("Reset");
    const old = await createSession(u.id);
    const m = fakeMailer();
    await requestPasswordReset(u.email.toUpperCase(), m.mailer);
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]).toMatchObject({ to: u.email, subject: "Reset your RoomSync password" });
    const token = m.tokenOf();
    expect(JSON.stringify(await prisma.passwordReset.findMany())).not.toContain(token); // only a hash is stored
    expect(await checkResetToken(token)).toBe(true);

    expect(await resetPassword(token, "brandnewpass")).toBe(u.id);
    await expect(verifyLogin(u.email, "brandnewpass")).resolves.toMatchObject({ id: u.id });
    expect(await getUserBySessionToken(old.token)).toBeNull();
    // Used up.
    expect(await checkResetToken(token)).toBe(false);
    await expect(resetPassword(token, "anotherpass1")).rejects.toThrow(/expired or was already used/);
  });

  it("says nothing about unknown emails, and limits requests", async () => {
    const m = fakeMailer();
    await expect(requestPasswordReset("nobody-here@test.dev", m.mailer)).resolves.toBeUndefined();
    expect(m.sent).toHaveLength(0);
    const u = await makeUser("Limit");
    for (let i = 0; i < 5; i++) await requestPasswordReset(u.email, m.mailer);
    expect(m.sent).toHaveLength(3);
  });

  it("links expire after an hour", async () => {
    const u = await makeUser("Exp");
    const m = fakeMailer();
    const t0 = new Date();
    await requestPasswordReset(u.email, m.mailer, t0);
    const later = new Date(t0.getTime() + 61 * 60_000);
    expect(await checkResetToken(m.tokenOf(), later)).toBe(false);
    await expect(resetPassword(m.tokenOf(), "brandnewpass", later)).rejects.toThrow(/expired/);
    await expect(verifyLogin(u.email, "password123")).resolves.toBeTruthy();
  });

  it("changing the password cancels outstanding links, and junk tokens are refused", async () => {
    const u = await makeUser("Cancel");
    const m = fakeMailer();
    await requestPasswordReset(u.email, m.mailer);
    await changePassword(u.id, "password123", "newpassword1");
    expect(await checkResetToken(m.tokenOf())).toBe(false);
    expect(await checkResetToken("short")).toBe(false);
    expect(await checkResetToken("x".repeat(43))).toBe(false);
  });

  it("refuses when email isn't set up", async () => {
    await expect(requestPasswordReset("a@b.co", null)).rejects.toThrow(/isn't set up/);
  });
});

describe("login guessing limit", () => {
  it("locks an email for 15 minutes after 10 wrong passwords, even the right one", async () => {
    const u = await makeUser("Lock");
    const t0 = new Date();
    for (let i = 0; i < 10; i++) await expect(verifyLogin(u.email, "nope-" + i, t0)).rejects.toThrow(/incorrect/);
    await expect(verifyLogin(u.email, "password123", t0)).rejects.toThrow(/Too many tries/);
    // Other accounts are unaffected.
    const other = await makeUser("Free");
    await expect(verifyLogin(other.email, "password123", t0)).resolves.toMatchObject({ id: other.id });
    // After the window it works, and a success clears the count.
    const later = new Date(t0.getTime() + 16 * 60_000);
    await expect(verifyLogin(u.email, "password123", later)).resolves.toMatchObject({ id: u.id });
    expect(await prisma.loginFailure.count({ where: { email: u.email } })).toBe(0);
  });

  it("a wrong password a few times doesn't lock you out", async () => {
    const u = await makeUser("Few");
    for (let i = 0; i < 3; i++) await expect(verifyLogin(u.email, "wrong")).rejects.toThrow(/incorrect/);
    await expect(verifyLogin(u.email, "password123")).resolves.toBeTruthy();
  });
});

describe("clean up", () => {
  it("drops expired sessions and stale login records, keeps live ones", async () => {
    const { cleanUp } = await import("@/server/jobs");
    const u = await makeUser("Clean");
    const live = await createSession(u.id);
    await prisma.session.create({ data: { id: "expired-session", userId: u.id, expiresAt: new Date(Date.now() - 1000) } });
    await prisma.loginFailure.create({ data: { email: "x@y.z", createdAt: new Date(Date.now() - 2 * 86400_000) } });
    await prisma.loginFailure.create({ data: { email: "x@y.z" } });
    await cleanUp();
    expect(await prisma.session.count()).toBe(1);
    expect(await getUserBySessionToken(live.token)).not.toBeNull();
    expect(await prisma.loginFailure.count()).toBe(1);
  });
});
