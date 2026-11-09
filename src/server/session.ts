import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createSession, deleteSession, getUserBySessionToken, type PublicUser } from "./auth";
import { listMyHouseholds } from "./households";

const SESSION_COOKIE = "rs_session";
const HOUSEHOLD_COOKIE = "rs_household";

export async function startSession(userId: string) {
  const { token, expiresAt } = await createSession(userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  jar.delete(SESSION_COOKIE);
  jar.delete(HOUSEHOLD_COOKIE);
}

export const getCurrentUser = cache(async (): Promise<PublicUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getUserBySessionToken(token);
});

export async function requireUser(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function setCurrentHousehold(householdId: string) {
  (await cookies()).set(HOUSEHOLD_COOKIE, householdId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

/**
 * The household the user is currently viewing. The cookie is only a preference —
 * it's validated against the user's memberships on every request.
 */
export const requireHousehold = cache(async () => {
  const user = await requireUser();
  const households = await listMyHouseholds(user.id);
  if (households.length === 0) redirect("/onboarding");
  const wanted = (await cookies()).get(HOUSEHOLD_COOKIE)?.value;
  const household = households.find((h) => h.id === wanted) ?? households[0];
  return { user, household, households };
});

/** The raw token of this browser's session, so a password change can keep it signed in. */
export async function currentSessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}
