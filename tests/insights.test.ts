import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { makeHousehold } from "./helpers";
import { createExpense, recordSettlement } from "@/server/expenses";
import { exportLedgerCsv, insightsMonth, spendingInsights } from "@/server/insights";

const TZ = "America/New_York";
const NOW = DateTime.fromISO("2026-03-20T12:00", { zone: TZ }).toJSDate();

describe("spending insights", () => {
  it("picks a valid, non-future month", () => {
    expect(insightsMonth(TZ, null, NOW)).toBe("2026-03");
    expect(insightsMonth(TZ, "2026-01", NOW)).toBe("2026-01");
    expect(insightsMonth(TZ, "2026-09", NOW)).toBe("2026-03");
    expect(insightsMonth(TZ, "2026-13", NOW)).toBe("2026-03");
  });

  it("totals the month, the viewer's share, and a six-month trend", async () => {
    const { household, owner, members } = await makeHousehold(1);
    const [a, b] = members;
    const add = (amountCents: number, date: string, category: string, payerId = a.id, participants = [{ userId: a.id }, { userId: b.id }]) =>
      createExpense(owner.id, household.id, { payerId, amountCents, date, description: `${category} ${date}`, category, splitMethod: "EQUAL", participants });
    await add(10000, "2026-03-02", "groceries");
    await add(3000, "2026-03-10", "utilities", b.id);
    await add(5000, "2026-03-11", "groceries", b.id, [{ userId: b.id }]);
    await add(8000, "2026-02-15", "groceries");
    await add(999, "2025-08-01", "other"); // outside the 6-month window

    const r = await spendingInsights(a.id, household.id, null, NOW);
    expect(r.total).toBe(18000);
    expect(r.mine).toBe(6500);
    expect(r.paidByMe).toBe(10000);
    expect(r.changePct).toBe(125);
    expect(r.categories[0]).toMatchObject({ category: "groceries", total: 15000, mine: 5000, count: 2 });
    expect(r.biggest?.amountCents).toBe(10000);
    expect(r.trend.map((t) => t.month)).toEqual(["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]);
    expect(r.trend[4].total).toBe(8000);
    expect(r.nextMonth).toBeNull();
  });

  it("exports a CSV with a share column per person and safe text", async () => {
    const { household, owner, members } = await makeHousehold(1);
    const [a, b] = members;
    await createExpense(owner.id, household.id, { payerId: a.id, amountCents: 1001, date: "2026-03-02", description: '=HYPERLINK("x"), "quoted"', category: "other", splitMethod: "EQUAL", participants: [{ userId: a.id }, { userId: b.id }] });
    await recordSettlement(owner.id, household.id, { fromUserId: b.id, toUserId: a.id, amountCents: 500, date: "2026-03-03", note: null });
    const csv = await exportLedgerCsv(b.id, household.id);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(`Date,Type,Description,Category,Amount,Paid by,Split,${a.name} share,${b.name} share`);
    expect(lines[1]).toBe(`2026-03-02,Expense,"'=HYPERLINK(""x""), ""quoted""",other,10.01,${a.name},equal,5.01,5.00`);
    expect(lines[2]).toBe(`2026-03-03,Payment,${b.name} paid ${a.name},,5.00,${b.name},,,`);
    const outsider = (await makeHousehold(0, "Other")).owner;
    await expect(exportLedgerCsv(outsider.id, household.id)).rejects.toThrow();
  });
});
