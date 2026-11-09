import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { invalid } from "./errors";

export const DELETED_NAME = "Former roommate";

/** What stands between this user and deleting their account. */
export async function accountDeletionBlockers(userId: string) {
  const active = await prisma.membership.findMany({
    where: { userId, leftAt: null },
    include: { household: { select: { name: true } } },
  });
  return active.map((m) => m.household.name);
}

/**
 * Delete an account. Shared money history has to stay correct for the roommates, so the user
 * row is kept but stripped of everything personal: name, email, password, pay handles,
 * devices, calendars, availability, notifications and assistant history. Expenses and
 * payments they were part of now show "Former roommate".
 * They must move out of every household first, which is where balances get settled.
 */
export async function deleteAccount(userId: string, password: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.isDemo) throw invalid("The demo account can't be deleted. It's cleaned up automatically.");
  if (!(await bcrypt.compare(String(password ?? ""), user.passwordHash))) throw invalid("That password is incorrect");
  const households = await accountDeletionBlockers(userId);
  if (households.length) {
    throw invalid(`Move out of ${households.join(", ")} first (Household → Move out). That's where you settle up with your roommates.`);
  }
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { userId } }),
    prisma.availabilityWindow.deleteMany({ where: { userId } }),
    prisma.calendarConnection.deleteMany({ where: { userId } }),
    prisma.calendarFeed.deleteMany({ where: { userId } }),
    prisma.notification.deleteMany({ where: { userId } }),
    prisma.pushSubscription.deleteMany({ where: { userId } }),
    prisma.passwordReset.deleteMany({ where: { userId } }),
    prisma.assistantAction.deleteMany({ where: { userId } }),
    prisma.loginFailure.deleteMany({ where: { email: user.email } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        name: DELETED_NAME,
        // Frees the address for a new sign-up; .invalid can never receive mail.
        email: `deleted-${userId}@deleted.invalid`,
        passwordHash: "!", // not a bcrypt hash, so no password can ever match
        notifyInApp: false,
        notifyEmail: false,
        venmoHandle: null,
        paypalHandle: null,
        cashtag: null,
      },
    }),
  ]);
}
