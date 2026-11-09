import { describe, expect, it } from "vitest";
import { allocateByWeights, itemizedSplit, parsePercent } from "@/lib/split";
import { makeHousehold } from "./helpers";
import { computeBalances, createExpense, getExpense, updateExpense } from "@/server/expenses";

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe("split engine", () => {
  it("allocates by weights exactly, with deterministic leftover cents", () => {
    expect(allocateByWeights(1000, [2, 1, 1])).toEqual([500, 250, 250]);
    expect(allocateByWeights(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateByWeights(1001, [3333, 3333, 3334])).toEqual([334, 333, 334]);
    expect(allocateByWeights(999, [0, 5, 0])).toEqual([0, 999, 0]);
    for (const [t, w] of [[1, [1, 1, 1]], [997, [7, 3, 11, 2]], [12345, [2500, 2500, 5000]]] as const) expect(sum(allocateByWeights(t, [...w]))).toBe(t);
  });

  it("splits items and shares tax/tip in proportion", () => {
    // Wine $20 for a+b, pizza $30 for a+b+c, $10 tax/tip on top.
    const per = itemizedSplit(6000, [{ name: "Wine", amountCents: 2000, userIds: ["a", "b"] }, { name: "Pizza", amountCents: 3000, userIds: ["a", "b", "c"] }]);
    expect(Object.fromEntries(per)).toEqual({ a: 2400, b: 2400, c: 1200 });
    expect(() => itemizedSplit(100, [{ name: "x", amountCents: 200, userIds: ["a"] }])).toThrow(/more than the total/);
  });

  it("parses percents to basis points", () => {
    expect(parsePercent("12.5")).toBe(1250);
    expect(parsePercent("100%")).toBe(10000);
    expect(parsePercent("abc")).toBeNull();
    expect(parsePercent("1.234")).toBeNull();
  });
});

describe("expenses with new split methods", () => {
  it("saves shares, percent and itemized splits that always sum to the total", async () => {
    const { household, owner, members } = await makeHousehold(2);
    const [a, b, c] = members;
    const base = { payerId: a.id, date: "2026-03-04", description: "Test", category: "rent" };
    const shares = await createExpense(owner.id, household.id, { ...base, amountCents: 100000, splitMethod: "SHARES", participants: [{ userId: a.id, weight: 2 }, { userId: b.id, weight: 1 }, { userId: c.id, weight: 1 }] });
    expect(shares.splits.map((s) => [s.userId, s.amountCents, s.weight])).toEqual([[a.id, 50000, 2], [b.id, 25000, 1], [c.id, 25000, 1]]);

    const pct = await createExpense(owner.id, household.id, { ...base, amountCents: 1001, splitMethod: "PERCENT", participants: [{ userId: a.id, weight: 3333 }, { userId: b.id, weight: 3333 }, { userId: c.id, weight: 3334 }] });
    expect(sum(pct.splits.map((s) => s.amountCents))).toBe(1001);

    const items = await createExpense(owner.id, household.id, { ...base, amountCents: 6000, splitMethod: "ITEMIZED", items: [
      { name: "Wine", amountCents: 2000, userIds: [a.id, b.id] }, { name: "Pizza", amountCents: 3000, userIds: [a.id, b.id, c.id] },
    ] });
    expect(Object.fromEntries(items.splits.map((s) => [s.userId, s.amountCents]))).toEqual({ [a.id]: 2400, [b.id]: 2400, [c.id]: 1200 });
    const loaded = await getExpense(owner.id, items.id);
    expect(loaded.items.map((i) => i.name)).toEqual(["Wine", "Pizza"]);

    // Editing to an equal split drops the items.
    await updateExpense(owner.id, items.id, { ...base, amountCents: 6000, splitMethod: "EQUAL", participants: [{ userId: a.id }, { userId: b.id }] });
    expect((await getExpense(owner.id, items.id)).items).toHaveLength(0);

    const { balances } = await computeBalances(owner.id, household.id);
    expect(sum(balances.map((x) => x.cents))).toBe(0);
  });

  it("rejects splits that don't add up", async () => {
    const { household, owner, members } = await makeHousehold(1);
    const [a, b] = members;
    const base = { payerId: a.id, date: "2026-03-04", description: "Test", amountCents: 1000 };
    await expect(createExpense(owner.id, household.id, { ...base, splitMethod: "PERCENT", participants: [{ userId: a.id, weight: 5000 }, { userId: b.id, weight: 4000 }] })).rejects.toThrow(/90%, not 100%/);
    await expect(createExpense(owner.id, household.id, { ...base, splitMethod: "SHARES", participants: [{ userId: a.id, weight: 0 }] })).rejects.toThrow(/at least one person a share/);
    await expect(createExpense(owner.id, household.id, { ...base, splitMethod: "ITEMIZED", items: [{ name: "Big", amountCents: 2000, userIds: [a.id] }] })).rejects.toThrow(/more than the total/);
    await expect(createExpense(owner.id, household.id, { ...base, splitMethod: "ITEMIZED", items: [] })).rejects.toThrow(/Add at least one item/);
    const outsider = (await makeHousehold(0, "Other")).owner;
    await expect(createExpense(owner.id, household.id, { ...base, splitMethod: "ITEMIZED", items: [{ name: "x", amountCents: 500, userIds: [outsider.id] }] })).rejects.toThrow();
  });
});
