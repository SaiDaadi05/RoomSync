import { describe, expect, it } from "vitest";
import { cleanHandle, payLinks } from "@/lib/pay-links";
import { makeHousehold, makeUser } from "./helpers";
import { getPayHandles, remindToSettle, updatePayHandles } from "@/server/payments";
import { createExpense } from "@/server/expenses";
import { prisma } from "@/server/db";

describe("pay links", () => {
  it("cleans handles typed in many ways", () => {
    expect(cleanHandle("@alex-rivera")).toBe("alex-rivera");
    expect(cleanHandle("$alexr")).toBe("alexr");
    expect(cleanHandle("https://venmo.com/u/alex_r")).toBe("alex_r");
    expect(cleanHandle("https://paypal.me/alexrivera/")).toBe("alexrivera");
    expect(cleanHandle("  ")).toBeNull();
    expect(cleanHandle("alex rivera")).toBeNull();
    expect(cleanHandle("javascript:alert(1)")).toBeNull();
  });

  it("builds links with the amount filled in, only for apps the person set up", () => {
    const links = payLinks({ venmoHandle: "alex-rivera", paypalHandle: null, cashtag: "alexr" }, 3589, "RoomSync: Maple St");
    expect(links).toEqual([
      { app: "Venmo", href: "https://venmo.com/?txn=pay&recipients=alex-rivera&amount=35.89&note=RoomSync%3A%20Maple%20St" },
      { app: "Cash App", href: "https://cash.app/$alexr/35.89" },
    ]);
    expect(payLinks({}, 100)).toEqual([]);
  });

  it("saves, clears and rejects handles", async () => {
    const u = await makeUser("Payee");
    await updatePayHandles(u.id, { venmoHandle: "@payee", paypalHandle: "", cashtag: "$payee1" });
    expect((await getPayHandles([u.id])).get(u.id)).toMatchObject({ venmoHandle: "payee", paypalHandle: null, cashtag: "payee1" });
    await expect(updatePayHandles(u.id, { venmoHandle: "not a handle!" })).rejects.toThrow(/doesn't look right/);
    await updatePayHandles(u.id, {});
    expect((await getPayHandles([u.id])).get(u.id)).toMatchObject({ venmoHandle: null, cashtag: null });
  });
});

describe("settle-up reminders", () => {
  it("reminds someone who owes you, once per week", async () => {
    const { household, owner, members } = await makeHousehold(1);
    const [a, b] = members;
    await createExpense(owner.id, household.id, { payerId: a.id, amountCents: 2000, date: "2026-03-02", description: "Soap", splitMethod: "EQUAL", participants: [{ userId: a.id }, { userId: b.id }] });
    const mon = new Date("2026-03-02T15:00:00Z"), wed = new Date("2026-03-04T15:00:00Z"), nextMon = new Date("2026-03-09T15:00:00Z");
    expect(await remindToSettle(a.id, household.id, b.id, mon)).toMatchObject({ sent: true });
    expect(await remindToSettle(a.id, household.id, b.id, wed)).toMatchObject({ sent: false });
    expect(await remindToSettle(a.id, household.id, b.id, nextMon)).toMatchObject({ sent: true });
    const notes = await prisma.notification.findMany({ where: { userId: b.id, type: "settle_reminder" } });
    expect(notes).toHaveLength(2);
    expect(notes[0].title).toMatch(/asked you to settle up: \$10\.00/);
    // The debtor can't "remind" the person they owe, and outsiders can't remind anyone.
    await expect(remindToSettle(b.id, household.id, a.id, mon)).rejects.toThrow(/don't owe you/);
    const outsider = (await makeHousehold(0, "Other")).owner;
    await expect(remindToSettle(outsider.id, household.id, b.id, mon)).rejects.toThrow();
  });
});
