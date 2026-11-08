import { createSampleHousehold } from "./sample-data";

export function demoEnabled() {
  return process.env.DEMO_MODE_ENABLED === "true";
}

/**
 * Create a brand-new, isolated demo household for this visitor. Demo users and
 * households are flagged isDemo, use an unroutable email domain, and can never
 * join or be joined by real accounts (enforced in acceptInvitation).
 */
export async function createDemoHousehold() {
  if (!demoEnabled()) throw new Error("Demo mode is disabled");
  const { household, users } = await createSampleHousehold({ isDemo: true, emailDomain: "demo.roomsync.invalid", householdName: "Demo Apartment" });
  return { household, user: users[0] };
}
