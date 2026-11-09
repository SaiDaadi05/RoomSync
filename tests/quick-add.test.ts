import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "@/lib/quick-add";

// 2026-11-09 is a Monday.
const ctx = {
  today: "2026-11-09",
  tz: "America/New_York",
  currentUserId: "u-alex",
  members: [{ id: "u-alex", name: "Alex Rivera" }, { id: "u-jordan", name: "Jordan Lee" }, { id: "u-sam", name: "Sam Patel" }],
};
const p = (s: string) => parseQuickAdd(s, ctx);

describe("parseQuickAdd", () => {
  it("treats plain nouns as shopping items", () => {
    expect(p("paper towels")).toMatchObject({ kind: "shopping", name: "Paper towels", quantity: "1" });
    expect(p("oat milk x2")).toMatchObject({ kind: "shopping", name: "Oat milk", quantity: "2" });
    expect(p("3 lemons")).toMatchObject({ kind: "shopping", name: "Lemons", quantity: "3" });
    expect(p("16 oz coffee")).toMatchObject({ kind: "shopping", name: "16 oz coffee", quantity: "1" });
  });

  it("honours explicit shopping cues", () => {
    expect(p("buy dish soap")).toMatchObject({ kind: "shopping", name: "Dish soap" });
    expect(p("we're out of eggs")).toMatchObject({ kind: "shopping", name: "Eggs" });
    expect(p("trash bags to the list")).toMatchObject({ kind: "shopping", name: "Trash bags" });
  });

  it("makes one-off chores from verbs and dates", () => {
    expect(p("unload groceries")).toMatchObject({ kind: "task", title: "Unload groceries", recurrence: "NONE", startsOn: "2026-11-09", dueTime: "20:00", assigneeId: null });
    expect(p("clean the fridge tomorrow at 6pm")).toMatchObject({ kind: "task", title: "Clean the fridge", startsOn: "2026-11-10", dueTime: "18:00", category: "kitchen" });
    expect(p("vacuum tonight")).toMatchObject({ kind: "task", title: "Vacuum", startsOn: "2026-11-09", dueTime: "21:00" });
    expect(p("mop floors fri")).toMatchObject({ kind: "task", startsOn: "2026-11-13" });
    expect(p("water plants monday")).toMatchObject({ kind: "task", startsOn: "2026-11-09" });
  });

  it("makes recurring chores", () => {
    expect(p("trash every Tue")).toMatchObject({ kind: "task", title: "Trash", recurrence: "WEEKLY", weekdays: [2], startsOn: "2026-11-10", category: "trash" });
    expect(p("take out recycling every mon and thu")).toMatchObject({ recurrence: "WEEKLY", weekdays: [1, 4], startsOn: "2026-11-09" });
    expect(p("dishes every day")).toMatchObject({ recurrence: "DAILY", category: "kitchen" });
    expect(p("clean bathroom every other sat")).toMatchObject({ recurrence: "WEEKLY", interval: 2, weekdays: [6], category: "bathroom" });
    expect(p("tidy living room weekdays 7pm")).toMatchObject({ recurrence: "WEEKLY", weekdays: [1, 2, 3, 4, 5], dueTime: "19:00" });
  });

  it("assigns to a roommate by first name or @mention", () => {
    expect(p("laundry sunday @jordan")).toMatchObject({ kind: "task", assigneeId: "u-jordan", startsOn: "2026-11-15", category: "laundry" });
    expect(p("sweep porch for sam")).toMatchObject({ kind: "task", title: "Sweep porch", assigneeId: "u-sam" });
    expect(p("feed the cat for me")).toMatchObject({ assigneeId: "u-alex" });
    // Not a roommate: stays in the title.
    expect(p("shop for groceries")).toMatchObject({ kind: "task", title: "Shop for groceries", assigneeId: null, category: "groceries" });
  });

  it("opens an expense for dollar amounts", () => {
    expect(p("$42 pizza")).toMatchObject({ kind: "expense", amount: "42.00", description: "Pizza" });
    expect(p("internet bill $60.5")).toMatchObject({ kind: "expense", amount: "60.50", description: "Internet bill" });
  });

  it("does not mistake quantities for times", () => {
    expect(p("2 sponges")).toMatchObject({ kind: "shopping", quantity: "2" });
  });

  it("ignores empty input", () => {
    expect(p("   ")).toBeNull();
  });
});

describe("parseQuickAdd unknown names", () => {
  it("drops an @mention that matches nobody and says so", () => {
    const r = p("dishes every day @ben");
    expect(r).toMatchObject({ kind: "task", title: "Dishes", assigneeId: null, recurrence: "DAILY" });
    expect(r!.summary).toMatch(/no roommate called “ben”/);
  });
});
