import { DateTime } from "luxon";
import { prisma } from "./db";
import { requireMember } from "./access";

const MONTHS = 6;

/** "YYYY-MM" in the household's timezone; refuses future months and junk. */
export function insightsMonth(tz: string, month?: string | null, now = new Date()) {
  const current = DateTime.fromJSDate(now).setZone(tz).startOf("month");
  if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    const m = DateTime.fromISO(`${month}-01`, { zone: tz });
    if (m.isValid && m <= current) return m.toFormat("yyyy-LL");
  }
  return current.toFormat("yyyy-LL");
}

/**
 * Spending for one month plus a six-month trend. "Mine" is the viewer's share of each
 * expense (what they consumed), which is different from what they happened to pay for.
 */
export async function spendingInsights(userId: string, householdId: string, month?: string | null, now = new Date()) {
  const m = await requireMember(userId, householdId);
  const tz = m.household.timezone;
  const sel = insightsMonth(tz, month, now);
  const selDt = DateTime.fromISO(`${sel}-01`, { zone: tz });
  const first = selDt.minus({ months: MONTHS - 1 });
  const expenses = await prisma.expense.findMany({
    where: { householdId, deletedAt: null, date: { gte: first.toISODate()!, lt: selDt.plus({ months: 1 }).toISODate()! } },
    include: { splits: { select: { userId: true, amountCents: true } } },
  });
  const myShare = (e: (typeof expenses)[number]) => e.splits.find((s) => s.userId === userId)?.amountCents ?? 0;

  const trend = Array.from({ length: MONTHS }, (_, i) => {
    const d = first.plus({ months: i });
    const key = d.toFormat("yyyy-LL");
    const inMonth = expenses.filter((e) => e.date.startsWith(key));
    return { month: key, label: d.toFormat("LLL"), total: inMonth.reduce((s, e) => s + e.amountCents, 0), mine: inMonth.reduce((s, e) => s + myShare(e), 0) };
  });

  const inSel = expenses.filter((e) => e.date.startsWith(sel));
  const cats = new Map<string, { category: string; total: number; mine: number; count: number }>();
  for (const e of inSel) {
    const c = cats.get(e.category) ?? { category: e.category, total: 0, mine: 0, count: 0 };
    c.total += e.amountCents; c.mine += myShare(e); c.count++;
    cats.set(e.category, c);
  }
  const cur = trend[MONTHS - 1];
  const prev = trend[MONTHS - 2];
  const biggest = inSel.reduce<(typeof inSel)[number] | null>((b, e) => (!b || e.amountCents > b.amountCents ? e : b), null);

  return {
    month: sel,
    label: selDt.toFormat("LLLL yyyy"),
    prevMonth: selDt.minus({ months: 1 }).toFormat("yyyy-LL"),
    nextMonth: selDt < DateTime.fromJSDate(now).setZone(tz).startOf("month") ? selDt.plus({ months: 1 }).toFormat("yyyy-LL") : null,
    total: cur.total,
    mine: cur.mine,
    paidByMe: inSel.filter((e) => e.payerId === userId).reduce((s, e) => s + e.amountCents, 0),
    count: inSel.length,
    changePct: prev.total > 0 ? Math.round(((cur.total - prev.total) / prev.total) * 100) : null,
    categories: [...cats.values()].sort((a, b) => b.total - a.total || a.category.localeCompare(b.category)),
    biggest: biggest && { id: biggest.id, description: biggest.description, amountCents: biggest.amountCents, date: biggest.date },
    trend,
  };
}

// ---- CSV export ----

/** Quote a CSV cell, and neutralise spreadsheet formulas (=, +, -, @) in text cells. */
function cell(v: string | number | null | undefined, text = true) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (text && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const dollars = (c: number) => (c / 100).toFixed(2);

/** Every expense and payment in the household, one row each, with a share column per person. */
export async function exportLedgerCsv(userId: string, householdId: string) {
  await requireMember(userId, householdId);
  const [expenses, settlements, members] = await Promise.all([
    prisma.expense.findMany({ where: { householdId, deletedAt: null }, include: { splits: true }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
    prisma.settlement.findMany({ where: { householdId }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
    prisma.membership.findMany({ where: { householdId }, include: { user: { select: { id: true, name: true } } }, orderBy: { joinedAt: "asc" } }),
  ]);
  const name = new Map(members.map((m) => [m.userId, m.user.name]));
  const header = ["Date", "Type", "Description", "Category", "Amount", "Paid by", "Split", ...members.map((m) => `${m.user.name} share`)];
  type Row = { date: string; at: number; cells: string[] };
  const rows: Row[] = [
    ...expenses.map((e) => ({
      date: e.date, at: e.createdAt.getTime(),
      cells: [cell(e.date), "Expense", cell(e.description), cell(e.category), cell(dollars(e.amountCents), false), cell(name.get(e.payerId) ?? "Unknown"), cell(e.splitMethod.toLowerCase()),
        ...members.map((m) => { const s = e.splits.find((x) => x.userId === m.userId); return s ? cell(dollars(s.amountCents), false) : ""; })],
    })),
    ...settlements.map((s) => ({
      date: s.date, at: s.createdAt.getTime(),
      cells: [cell(s.date), "Payment", cell(`${name.get(s.fromUserId) ?? "Unknown"} paid ${name.get(s.toUserId) ?? "Unknown"}${s.note ? ` (${s.note})` : ""}`), "", cell(dollars(s.amountCents), false), cell(name.get(s.fromUserId) ?? "Unknown"), "", ...members.map(() => "")],
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at);
  return [header.map((h) => cell(h)).join(","), ...rows.map((r) => r.cells.join(","))].join("\r\n") + "\r\n";
}
