import { describe, expect, it } from "vitest";
import { makeHousehold } from "./helpers";
import { addShoppingItem, householdStaples, markPurchased, restockItem } from "@/server/shopping";

async function buy(userId: string, householdId: string, name: string) {
  const i = await addShoppingItem(userId, householdId, { name, quantity: "2", notes: "the big one" });
  await markPurchased(userId, [i.id]);
  return i;
}

describe("household staples", () => {
  it("suggests things bought at least twice that aren't on the list, most frequent first", async () => {
    const { household, owner } = await makeHousehold(0);
    for (let n = 0; n < 3; n++) await buy(owner.id, household.id, "Dish soap");
    await buy(owner.id, household.id, "Eggs");
    await buy(owner.id, household.id, "eggs");
    await buy(owner.id, household.id, "Batteries");
    await buy(owner.id, household.id, "Milk");
    await buy(owner.id, household.id, "Milk");
    await addShoppingItem(owner.id, household.id, { name: "milk" }); // already on the list

    const staples = await householdStaples(owner.id, household.id);
    expect(staples.map((s) => [s.name.toLowerCase(), s.count])).toEqual([["dish soap", 3], ["eggs", 2]]);

    // One tap re-adds it with the same quantity and note, then it drops out of suggestions.
    const re = await restockItem(owner.id, staples[0].itemId);
    expect(re).toMatchObject({ name: "Dish soap", quantity: "2", notes: "the big one", status: "NEEDED" });
    expect((await householdStaples(owner.id, household.id)).map((s) => s.name.toLowerCase())).toEqual(["eggs"]);
    await expect(restockItem(owner.id, staples[0].itemId)).rejects.toThrow(/already on the list/);
  });

  it("never shows another household's items", async () => {
    const a = await makeHousehold(0);
    const b = await makeHousehold(0);
    await buy(b.owner.id, b.household.id, "Coffee");
    await buy(b.owner.id, b.household.id, "Coffee");
    expect(await householdStaples(a.owner.id, a.household.id)).toEqual([]);
    await expect(householdStaples(a.owner.id, b.household.id)).rejects.toThrow(/not a member/);
    const theirs = (await householdStaples(b.owner.id, b.household.id))[0];
    await expect(restockItem(a.owner.id, theirs.itemId)).rejects.toThrow(/not a member/);
  });
});
