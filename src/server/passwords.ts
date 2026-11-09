import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "./db";
import { invalid } from "./errors";
import { emailConfigured } from "./notifications";
import { defaultMailer, type Mailer } from "./reminders";

export const RESET_TTL_MINUTES = 60;
const MAX_RESETS_PER_HOUR = 3;

const newPassword = z.string().min(8, "Password must be at least 8 characters").max(200, "That password is too long");
const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/** Change your password while signed in. Signs out every other device. */
export async function changePassword(userId: string, current: string, next: string, keepSessionToken?: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.isDemo) throw invalid("The demo account's password can't be changed");
  if (!(await bcrypt.compare(String(current ?? ""), user.passwordHash))) throw invalid("Your current password is incorrect");
  const pw = newPassword.parse(next);
  if (pw === current) throw invalid("Pick a password you haven't been using");
  const keep = keepSessionToken ? hash(keepSessionToken) : undefined;
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(pw, 12) } }),
    prisma.session.deleteMany({ where: { userId, ...(keep ? { id: { not: keep } } : {}) } }),
    prisma.passwordReset.deleteMany({ where: { userId } }),
  ]);
}

export const passwordResetAvailable = emailConfigured;

/**
 * Email a one-time reset link. Always resolves the same way whether or not the email has an
 * account, so the form can't be used to find out who's signed up.
 */
export async function requestPasswordReset(emailRaw: string, mailer: Mailer | null = defaultMailer(), now = new Date()) {
  if (!mailer) throw invalid("Password reset by email isn't set up on this server yet");
  const email = String(emailRaw ?? "").trim().toLowerCase();
  if (!z.string().email().safeParse(email).success) throw invalid("Enter a valid email");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.isDemo) return;
  const recent = await prisma.passwordReset.count({ where: { userId: user.id, createdAt: { gt: new Date(now.getTime() - 3600_000) } } });
  if (recent >= MAX_RESETS_PER_HOUR) return; // quietly; the earlier links still work

  const token = crypto.randomBytes(32).toString("base64url");
  await prisma.passwordReset.create({
    data: { userId: user.id, tokenHash: hash(token), expiresAt: new Date(now.getTime() + RESET_TTL_MINUTES * 60_000) },
  });
  const link = `${process.env.APP_URL ?? "http://localhost:3000"}/reset-password?token=${token}`;
  await mailer.sendMail({
    from: process.env.SMTP_FROM || "RoomSync <no-reply@example.com>",
    to: user.email,
    subject: "Reset your RoomSync password",
    text: `Hi ${user.name},\n\nSomeone (hopefully you) asked to reset your RoomSync password. This link works once, for the next hour:\n\n${link}\n\nIf it wasn't you, you can ignore this email. Your password hasn't changed.`,
  });
}

/** Is this reset link still good? Used to show the form or an "expired" message. */
export async function checkResetToken(token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token ?? "")) return false;
  const r = await prisma.passwordReset.findUnique({ where: { tokenHash: hash(token) } });
  return Boolean(r && !r.usedAt && r.expiresAt > now);
}

/** Set a new password from a reset link. Uses the link up and signs out every device. Returns the user id. */
export async function resetPassword(token: string, next: string, now = new Date()) {
  const pw = newPassword.parse(next);
  if (!(await checkResetToken(token, now))) throw invalid("This reset link has expired or was already used. Ask for a new one.");
  const r = await prisma.passwordReset.findUniqueOrThrow({ where: { tokenHash: hash(token) } });
  // Claim the link atomically so two submits can't both use it.
  const claimed = await prisma.passwordReset.updateMany({ where: { id: r.id, usedAt: null }, data: { usedAt: now } });
  if (!claimed.count) throw invalid("This reset link has expired or was already used. Ask for a new one.");
  const { email } = await prisma.user.findUniqueOrThrow({ where: { id: r.userId }, select: { email: true } });
  await prisma.$transaction([
    prisma.user.update({ where: { id: r.userId }, data: { passwordHash: await bcrypt.hash(pw, 12) } }),
    prisma.session.deleteMany({ where: { userId: r.userId } }),
    prisma.passwordReset.deleteMany({ where: { userId: r.userId, id: { not: r.id } } }),
    prisma.loginFailure.deleteMany({ where: { email } }), // a fresh password lifts any login lock
  ]);
  return r.userId;
}
