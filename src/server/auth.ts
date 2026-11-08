import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "./db";
import { AppError, invalid } from "./errors";
import { isValidTimezone } from "@/lib/time";

export const SESSION_TTL_DAYS = 30;

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  timezone: z.string().optional(),
});

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  timezone: string;
  preferredStartMin: number;
  preferredEndMin: number;
  notifyInApp: boolean;
  notifyEmail: boolean;
  isDemo: boolean;
};

export const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  timezone: true,
  preferredStartMin: true,
  preferredEndMin: true,
  notifyInApp: true,
  notifyEmail: true,
  isDemo: true,
} as const;

let _dummy: Promise<string> | null = null;
const dummyHash = () => (_dummy ??= bcrypt.hash("not-a-real-password", 12));

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function signUp(input: unknown): Promise<PublicUser> {
  const data = signUpSchema.parse(input);
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw new AppError("An account with that email already exists", "CONFLICT");
  const timezone = data.timezone && isValidTimezone(data.timezone) ? data.timezone : "America/New_York";
  return prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash: await bcrypt.hash(data.password, 12),
      timezone,
    },
    select: publicUserSelect,
  });
}

export async function verifyLogin(emailRaw: string, password: string): Promise<PublicUser> {
  const email = String(emailRaw ?? "").trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  // Always run a hash comparison so timing doesn't reveal whether the email exists.
  const ok = await bcrypt.compare(String(password ?? ""), user?.passwordHash ?? (await dummyHash()));
  if (!user || !ok) throw invalid("Email or password is incorrect");
  const { passwordHash: _ph, createdAt: _c, ...rest } = user;
  return rest;
}

/** Creates a session and returns the raw token for the cookie. Only its hash is stored. */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000);
  await prisma.session.create({ data: { id: hashToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

export async function getUserBySessionToken(token: string | undefined): Promise<PublicUser | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: { select: publicUserSelect } },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session.user;
}

export async function deleteSession(token: string) {
  await prisma.session.deleteMany({ where: { id: hashToken(token) } });
}

const prefsSchema = z.object({
  name: z.string().trim().min(1).max(60),
  timezone: z.string().refine(isValidTimezone, "Unknown timezone"),
  preferredStartMin: z.coerce.number().int().min(0).max(1440),
  preferredEndMin: z.coerce.number().int().min(0).max(1440),
  notifyInApp: z.boolean(),
  notifyEmail: z.boolean(),
});

export async function updatePreferences(userId: string, input: unknown): Promise<PublicUser> {
  const data = prefsSchema.parse(input);
  if (data.preferredEndMin <= data.preferredStartMin) throw invalid("Preferred end time must be after the start time");
  return prisma.user.update({ where: { id: userId }, data, select: publicUserSelect });
}
