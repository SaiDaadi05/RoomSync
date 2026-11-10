import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "./db";
import { netBalances } from "./expenses";
import { formatCents } from "@/lib/money";
import { activeMembers, requireMember, requireOwner } from "./access";
import { AppError, invalid } from "./errors";
import { leaveAndRelease } from "./members";
import { isValidTimezone } from "@/lib/time";

const householdSchema = z.object({
  name: z.string().trim().min(1, "Give your household a name").max(80),
  timezone: z.string().refine(isValidTimezone, "Unknown timezone"),
});

export async function createHousehold(userId: string, input: unknown, opts: { isDemo?: boolean } = {}) {
  const data = householdSchema.parse(input);
  return prisma.household.create({
    data: {
      ...data,
      isDemo: opts.isDemo ?? false,
      memberships: { create: { userId, role: "OWNER" } },
      invitations: { create: { code: generateInvitationCode(), createdById: userId, expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400_000) } },
    },
  });
}

export async function updateHousehold(userId: string, householdId: string, input: unknown) {
  await requireOwner(userId, householdId);
  const data = householdSchema.parse(input);
  return prisma.household.update({ where: { id: householdId }, data });
}

export async function listMyHouseholds(userId: string) {
  const rows = await prisma.membership.findMany({
    where: { userId, leftAt: null },
    include: { household: true },
    orderBy: { joinedAt: "asc" },
  });
  return rows.map((r) => ({ ...r.household, role: r.role }));
}

export async function getHouseholdOverview(userId: string, householdId: string) {
  const membership = await requireMember(userId, householdId);
  const members = await activeMembers(householdId);
  return { household: membership.household, role: membership.role, members };
}

// ---- Invitations ----

const INVITE_TTL_DAYS = 7;

function generateInvitationCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 10 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
}

export async function createInvitation(userId: string, householdId: string, email?: string | null) {
  await requireMember(userId, householdId);
  const cleanEmail = email ? z.string().trim().toLowerCase().email("Enter a valid email").parse(email) : null;
  const code = generateInvitationCode();
  return prisma.invitation.create({
    data: {
      householdId,
      code,
      email: cleanEmail,
      createdById: userId,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400_000),
    },
  });
}

export async function listInvitations(userId: string, householdId: string) {
  await requireMember(userId, householdId);
  return prisma.invitation.findMany({
    where: { householdId, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeInvitation(userId: string, invitationId: string) {
  const inv = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!inv) throw new AppError("Invitation not found", "NOT_FOUND");
  await requireMember(userId, inv.householdId);
  return prisma.invitation.update({ where: { id: invitationId }, data: { revokedAt: new Date() } });
}

export async function previewInvitation(codeRaw: string) {
  const code = String(codeRaw ?? "").trim().toUpperCase();
  const inv = await prisma.invitation.findUnique({ where: { code }, include: { household: { select: { name: true } } } });
  if (!inv || inv.revokedAt || inv.usedAt || inv.expiresAt < new Date()) return null;
  return { code: inv.code, householdName: inv.household.name, email: inv.email };
}

export async function acceptInvitation(userId: string, codeRaw: string) {
  const code = String(codeRaw ?? "").trim().toUpperCase();
  return prisma.$transaction(async (tx) => {
    const inv = await tx.invitation.findUnique({ where: { code } });
    if (!inv || inv.revokedAt || inv.usedAt || inv.expiresAt < new Date())
      throw invalid("That invite code is invalid or has expired");
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (inv.email && inv.email !== user.email) throw invalid("This invite was sent to a different email address");
    const household = await tx.household.findUniqueOrThrow({ where: { id: inv.householdId } });
    if (household.isDemo !== user.isDemo) throw invalid("Demo and real accounts can't share a household");

    const existing = await tx.membership.findUnique({
      where: { householdId_userId: { householdId: inv.householdId, userId } },
    });
    if (existing && !existing.leftAt) throw new AppError("You're already in this household", "CONFLICT");
    if (existing) {
      await tx.membership.update({ where: { id: existing.id }, data: { leftAt: null, joinedAt: new Date(), role: "MEMBER" } });
    } else {
      await tx.membership.create({ data: { householdId: inv.householdId, userId, role: "MEMBER" } });
    }
    // Atomic single-use: only succeeds if nobody used it in the meantime.
    const res = await tx.invitation.updateMany({
      where: { id: inv.id, usedAt: null },
      data: { usedAt: new Date(), usedById: userId },
    });
    if (res.count !== 1) throw invalid("That invite code was just used");
    return household;
  });
}

export async function leaveHousehold(userId: string, householdId: string, opts: { acknowledgeBalance?: boolean } = {}) {
  const m = await requireMember(userId, householdId);
  if (m.role === "OWNER") {
    const otherOwners = await prisma.membership.count({
      where: { householdId, role: "OWNER", leftAt: null, userId: { not: userId } },
    });
    const others = await prisma.membership.count({ where: { householdId, leftAt: null, userId: { not: userId } } });
    if (others > 0 && otherOwners === 0) throw invalid("Make another roommate an owner before leaving");
  }
  if (!opts.acknowledgeBalance) {
    const net = await netBalances(prisma, householdId);
    const cents = net.get(userId) ?? 0;
    if (cents !== 0) {
      const amount = formatCents(Math.abs(cents), m.household.currency);
      throw invalid(cents < 0 ? `You still owe ${amount}. Settle up first, or confirm you're leaving with a balance.` : `You're still owed ${amount}. Settle up first, or confirm you're leaving with a balance.`);
    }
  }
  await leaveAndRelease(userId, householdId);
}

const rulesSchema = z.object({
  rules: z.string().trim().max(2000, "Keep house rules under 2,000 characters").optional().nullable().transform((v) => v || null),
  quietStartMin: z.number().int().min(0).max(1439).nullable(),
  quietEndMin: z.number().int().min(0).max(1439).nullable(),
}).refine((v) => (v.quietStartMin === null) === (v.quietEndMin === null), { message: "Set both a start and an end for quiet hours, or neither" })
  .refine((v) => v.quietStartMin === null || v.quietStartMin !== v.quietEndMin, { message: "Quiet hours can't start and end at the same time" });

/** House rules and quiet hours. Owners edit; every member can read them on the Household page. */
export async function updateHouseRules(userId: string, householdId: string, input: unknown) {
  await requireOwner(userId, householdId);
  const data = rulesSchema.parse(input);
  return prisma.household.update({ where: { id: householdId }, data, select: { rules: true, quietStartMin: true, quietEndMin: true } });
}
