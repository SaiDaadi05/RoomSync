import { describe, expect, it } from "vitest";
import { makeHousehold } from "./helpers";
import { parseMoneyToCents, splitEqually } from "@/lib/money";
import {
  createExpense, computeBalances, recordSettlement, deleteExpense, simplifyDebts, attachReceipt, readReceipt,
} from "@/server/expenses";
import {
  addShoppingItem, claimShoppingItem, purchaseWithExpense, createShoppingErrand, listShopping, unclaimShoppingItem,
} from "@/server/shopping";
import { prisma } from "@/server/db";

describe("money helpers", () => {
  it("parses money without floating point drift", () => {
    expect(parseMoneyToCents("12.34")).toBe(1234);
    expect(parseMoneyToCents("$1,000.5")).toBe(100050);
    expect(parseMoneyToCents("0.1")).toBe(10);
    expect(parseMoneyToCents("19.99")).toBe(1999);
    expect(() => parseMoneyToCents("1.234")).toThrow();
    expect(() => parseMoneyToCents("abc")).toThrow();
  });
  it("splits equally with remainder cents that always sum to the total", () => {
    expect(splitEqually(1000, 3)).toEqual([334, 333, 333]);
    expect(splitEqually(1, 3)).toEqual([1, 0, 0]);
    for (const [t, n] of [[9999, 7], [100, 6], [12345, 4]]) expect(splitEqually(t, n).reduce((a, b) => a + b)).toBe(t);
  });
  it("simplifies debts into at most n-1 payments", () => {
    const s = simplifyDebts([{ userId: "a", cents: 3000 }, { userId: "b", cents: -1000 }, { userId: "c", cents: -2000 }]);
    expect(s).toEqual([{ fromUserId: "c", toUserId: "a", amountCents: 2000 }, { fromUserId: "b", toUserId: "a", amountCents: 1000 }]);
  });
});

describe("expenses and balances", () => {
  it("equal split: balances sum to zero and reflect who paid", async () => {
    const { household, members: [a, b, c] } = await makeHousehold(2);
    await createExpense(a.id, household.id, {
      payerId: a.id, amountCents: 10000, date: "2026-11-01", description: "Groceries", splitMethod: "EQUAL",
      participants: [{ userId: a.id }, { userId: b.id }, { userId: c.id }],
    });
    const { balances, suggestions } = await computeBalances(a.id, household.id);
    const by = Object.fromEntries(balances.map((x) => [x.userId, x.cents]));
    expect(by[a.id]).toBe(10000 - 3334);
    expect(by[b.id]).toBe(-3333);
    expect(by[c.id]).toBe(-3333);
    expect(balances.reduce((s, x) => s + x.cents, 0)).toBe(0);
    expect(suggestions.every((s) => s.toUserId === a.id)).toBe(true);
  });

  it("custom split must match the total exactly", async () => {
    const { household, members: [a, b] } = await makeHousehold(1);
    await expect(createExpense(a.id, household.id, {
      payerId: a.id, amountCents: 5000, date: "2026-11-01", description: "Internet", splitMethod: "CUSTOM",
      participants: [{ userId: a.id, amountCents: 2000 }, { userId: b.id, amountCents: 2999 }],
    })).rejects.toThrow(/add up to \$49\.99 but the total is \$50\.00/);
    const ok = await createExpense(a.id, household.id, {
      payerId: a.id, amountCents: 5000, date: "2026-11-01", description: "Internet", splitMethod: "CUSTOM",
      participants: [{ userId: a.id, amountCents: 2000 }, { userId: b.id, amountCents: 3000 }],
    });
    expect(ok.splits.reduce((s, x) => s + x.amountCents, 0)).toBe(5000);
  });

  it("settlements reduce balances to zero; deleted expenses drop out", async () => {
    const { household, members: [a, b] } = await makeHousehold(1);
    const e = await createExpense(b.id, household.id, {
      payerId: b.id, amountCents: 4000, date: "2026-11-02", description: "Paper towels", splitMethod: "EQUAL",
      participants: [{ userId: a.id }, { userId: b.id }],
    });
    await recordSettlement(a.id, household.id, { fromUserId: a.id, toUserId: b.id, amountCents: 2000, date: "2026-11-03" });
    let { balances, suggestions } = await computeBalances(a.id, household.id);
    expect(balances.every((x) => x.cents === 0)).toBe(true);
    expect(suggestions).toEqual([]);
    await deleteExpense(a.id, e.id);
    ({ balances } = await computeBalances(a.id, household.id));
    // Now only the settlement remains: a paid b 20 → b owes a 20
    expect(balances.find((x) => x.userId === a.id)?.cents).toBe(2000);
  });

  it("rejects payers/participants from other households and bad amounts", async () => {
    const h1 = await makeHousehold(1);
    const h2 = await makeHousehold(0);
    await expect(createExpense(h1.owner.id, h1.household.id, {
      payerId: h2.owner.id, amountCents: 100, date: "2026-11-01", description: "x", splitMethod: "EQUAL", participants: [{ userId: h1.owner.id }],
    })).rejects.toThrow(/member/);
    await expect(createExpense(h1.owner.id, h1.household.id, {
      payerId: h1.owner.id, amountCents: 0, date: "2026-11-01", description: "x", splitMethod: "EQUAL", participants: [{ userId: h1.owner.id }],
    })).rejects.toThrow();
    await expect(computeBalances(h2.owner.id, h1.household.id)).rejects.toThrow(/not a member/);
    await expect(recordSettlement(h1.owner.id, h1.household.id, { fromUserId: h1.owner.id, toUserId: h1.owner.id, amountCents: 5, date: "2026-11-01" })).rejects.toThrow(/different/);
  });

  it("receipts are validated and only readable by household members", async () => {
    const h1 = await makeHousehold(1);
    const h2 = await makeHousehold(0);
    const e = await createExpense(h1.owner.id, h1.household.id, {
      payerId: h1.owner.id, amountCents: 100, date: "2026-11-01", description: "x", splitMethod: "EQUAL", participants: [{ userId: h1.owner.id }],
    });
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    await expect(attachReceipt(h1.owner.id, e.id, Buffer.from("not a png"), "image/png")).rejects.toThrow(/doesn't look like/);
    await expect(attachReceipt(h1.owner.id, e.id, png, "text/html")).rejects.toThrow(/must be/);
    await attachReceipt(h1.owner.id, e.id, png, "image/png");
    const r = await readReceipt(h1.members[1].id, e.id);
    expect(r.data.equals(png)).toBe(true);
    await expect(readReceipt(h2.owner.id, e.id)).rejects.toThrow(/not a member/);
  });
});

describe("shopping", () => {
  it("prevents duplicate items and double claims", async () => {
    const { household, members: [a, b] } = await makeHousehold(1);
    const milk = await addShoppingItem(a.id, household.id, { name: "Oat milk", quantity: "2" });
    await expect(addShoppingItem(b.id, household.id, { name: "oat MILK" })).rejects.toThrow(/already on the list/);
    await expect(addShoppingItem(a.id, household.id, { name: "Soap", productUrl: "javascript:alert(1)" })).rejects.toThrow(/http/);
    await claimShoppingItem(a.id, milk.id);
    await expect(claimShoppingItem(b.id, milk.id)).rejects.toThrow(/already getting this/);
    await unclaimShoppingItem(a.id, milk.id);
    await claimShoppingItem(b.id, milk.id);
  });

  it("buying items records one linked expense and marks them purchased", async () => {
    const { household, members: [a, b] } = await makeHousehold(1);
    const i1 = await addShoppingItem(a.id, household.id, { name: "Dish soap" });
    const i2 = await addShoppingItem(a.id, household.id, { name: "Trash bags", productUrl: "https://www.amazon.com/dp/B000000000" });
    const exp = await purchaseWithExpense(b.id, household.id, { itemIds: [i1.id, i2.id], amountCents: 1599, date: "2026-11-05", participantIds: [a.id, b.id] });
    expect(exp.description).toBe("Dish soap + 1 more");
    const items = await prisma.shoppingItem.findMany({ where: { id: { in: [i1.id, i2.id] } } });
    expect(items.every((i) => i.status === "PURCHASED" && i.expenseId === exp.id && i.purchasedById === b.id)).toBe(true);
    // Can't attach the same items to a second expense
    await expect(purchaseWithExpense(b.id, household.id, { itemIds: [i1.id], amountCents: 100, date: "2026-11-05", participantIds: [a.id] })).rejects.toThrow(/already on another expense/);
    const { balances } = await computeBalances(a.id, household.id);
    expect(balances.find((x) => x.userId === a.id)?.cents).toBe(-800); // 1599 split 800/799, extra cent to first participant
  });

  it("creates a shopping-run errand linked to the items", async () => {
    const { household, members: [a, b] } = await makeHousehold(1);
    const i1 = await addShoppingItem(a.id, household.id, { name: "Eggs" });
    const { occurrence } = await createShoppingErrand(a.id, household.id, { itemIds: [i1.id], assigneeId: b.id });
    expect(occurrence.assigneeId).toBe(b.id);
    const { open } = await listShopping(a.id, household.id);
    expect(open[0].errandOccurrenceId).toBe(occurrence.id);
    expect(open[0].status).toBe("CLAIMED");
    expect(open[0].claimedById).toBe(b.id);
  });

  it("isolates shopping lists between households", async () => {
    const h1 = await makeHousehold(0);
    const h2 = await makeHousehold(0);
    const item = await addShoppingItem(h1.owner.id, h1.household.id, { name: "Rice" });
    await expect(claimShoppingItem(h2.owner.id, item.id)).rejects.toThrow(/not a member/);
    await expect(listShopping(h2.owner.id, h1.household.id)).rejects.toThrow(/not a member/);
    await expect(purchaseWithExpense(h2.owner.id, h2.household.id, { itemIds: [item.id], amountCents: 100, date: "2026-11-01", participantIds: [h2.owner.id] })).rejects.toThrow(/not found/);
  });
});
