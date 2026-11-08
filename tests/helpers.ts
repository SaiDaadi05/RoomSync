import { signUp } from "@/server/auth";
import { createHousehold, createInvitation, acceptInvitation } from "@/server/households";

let n = 0;
export async function makeUser(name = "User") {
  n++;
  return signUp({ name: `${name}${n}`, email: `${name.toLowerCase()}${n}-${Date.now()}@test.dev`, password: "password123", timezone: "America/New_York" });
}

/** A household with an owner and `extra` roommates who joined via invitation. */
export async function makeHousehold(extra = 1, name = "Test Apt") {
  const owner = await makeUser("Owner");
  const household = await createHousehold(owner.id, { name, timezone: "America/New_York" });
  const members = [owner];
  for (let i = 0; i < extra; i++) {
    const u = await makeUser("Mate");
    const inv = await createInvitation(owner.id, household.id);
    await acceptInvitation(u.id, inv.code);
    members.push(u);
  }
  return { household, owner, members };
}
