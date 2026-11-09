import { DateTime } from "luxon";
import { prisma } from "./db";
import { requireMember } from "./access";
import { simplifyDebts } from "./expenses";
import { ensureOccurrences } from "./tasks";
import { notify } from "./notifications";
import { formatCents } from "@/lib/money";

/** Sunday at or after this local hour, members get the week's recap. */
export const RECAP_HOUR = 18;

/**
 * The Monday (household-local, YYYY-MM-DD) of the week to recap.
 * With an explicit `week`, snaps it to its Monday and refuses future weeks.
 * Otherwise: on Sunday it's the week that is ending; any other day, last week.
 */
export function recapWeekStart(tz: string, week?: string | null, now = new Date()) {
  const today = DateTime.fromJSDate(now).setZone(tz).startOf("day");
  const thisMonday = today.startOf("week");
  if (week && /^\d{4}-\d{2}-\d{2}$/.test(week)) {
    const d = DateTime.fromISO(week, { zone: tz });
    if (d.isValid) {
      const monday = d.startOf("week");
      return (monday > thisMonday ? thisMonday : monday).toISODate()!;
    }
  }
  return (today.weekday === 7 ? thisMonday : thisMonday.minus({ weeks: 1 })).toISODate()!;
}

export type WeeklyRecap = Awaited<ReturnType<typeof buildRecap>>;

/** Internal: no access check. Callers must have checked membership. */
async function buildRecap(householdId: string, weekStart: string, now = new Date()) {
  const household = await prisma.household.findUniqueOrThrow({ where: { id: householdId } });
  const tz = household.timezone;
  const start = DateTime.fromISO(weekStart, { zone: tz }).startOf("day");
  const end = start.plus({ weeks: 1 });
  const lastDay = end.minus({ days: 1 }).toISODate()!;
  const nowDt = DateTime.fromJSDate(now);
  const ended = end <= nowDt;
  await ensureOccurrences(householdId, now);

  const [memberships, occs, expenses, settlements, purchased, allExpenses, allSettlements, upcoming] = await Promise.all([
    prisma.membership.findMany({ where: { householdId }, include: { user: { select: { id: true, name: true } } }, orderBy: { joinedAt: "asc" } }),
    prisma.taskOccurrence.findMany({
      where: { householdId, dueAt: { gte: start.toJSDate(), lt: end.toJSDate() } },
      include: { definition: { select: { title: true, estimatedMinutes: true } } },
    }),
    prisma.expense.findMany({ where: { householdId, deletedAt: null, date: { gte: weekStart, lte: lastDay } } }),
    prisma.settlement.findMany({ where: { householdId, date: { gte: weekStart, lte: lastDay } } }),
    prisma.shoppingItem.count({ where: { householdId, status: "PURCHASED", purchasedAt: { gte: start.toJSDate(), lt: end.toJSDate() } } }),
    prisma.expense.findMany({ where: { householdId, deletedAt: null }, include: { splits: true } }),
    prisma.settlement.findMany({ where: { householdId } }),
    prisma.taskOccurrence.findMany({
      where: { householdId, status: "PENDING", dueAt: { gte: now, lt: nowDt.plus({ days: 7 }).toJSDate() } },
      include: { definition: { select: { id: true, title: true, estimatedMinutes: true } } },
      orderBy: { dueAt: "asc" },
    }),
  ]);

  const nameOf = new Map(memberships.map((m) => [m.userId, m.user.name]));
  const people = new Map<string, { userId: string; name: string; active: boolean; done: number; minutes: number; missed: number; skipped: number }>();
  for (const m of memberships) {
    people.set(m.userId, { userId: m.userId, name: m.user.name, active: !m.leftAt, done: 0, minutes: 0, missed: 0, skipped: 0 });
  }
  let missedUnassigned = 0;
  for (const o of occs) {
    if (o.status === "DONE") {
      const p = people.get(o.completedById ?? o.assigneeId ?? "");
      if (p) { p.done++; p.minutes += o.definition.estimatedMinutes; }
    } else if (o.status === "SKIPPED") {
      const p = o.assigneeId ? people.get(o.assigneeId) : undefined;
      if (p) p.skipped++;
    } else if (o.dueAt < now) {
      const p = o.assigneeId ? people.get(o.assigneeId) : undefined;
      if (p) p.missed++;
      else missedUnassigned++;
    }
  }
  // Former members only appear if they did something that week.
  const chores = [...people.values()]
    .filter((p) => p.active || p.done || p.missed || p.skipped)
    .sort((a, b) => b.minutes - a.minutes || b.done - a.done || a.name.localeCompare(b.name));
  const doneTotal = chores.reduce((s, p) => s + p.done, 0);
  const missedTotal = chores.reduce((s, p) => s + p.missed, 0) + missedUnassigned;
  const top = chores[0] && chores[0].done > 0 && (chores.length === 1 || chores[0].minutes > chores[1].minutes) ? chores[0] : null;

  const byCategory = new Map<string, number>();
  for (const e of expenses) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amountCents);
  const spentCents = expenses.reduce((s, e) => s + e.amountCents, 0);

  // Current balances (all time), same rules as computeBalances.
  const net = new Map<string, number>(memberships.map((m) => [m.userId, 0]));
  const add = (id: string, v: number) => net.set(id, (net.get(id) ?? 0) + v);
  for (const e of allExpenses) {
    add(e.payerId, e.amountCents);
    for (const s of e.splits) add(s.userId, -s.amountCents);
  }
  for (const s of allSettlements) { add(s.fromUserId, s.amountCents); add(s.toUserId, -s.amountCents); }
  const owes = simplifyDebts([...net.entries()].map(([userId, cents]) => ({ userId, cents })))
    .map((d) => ({ ...d, fromName: nameOf.get(d.fromUserId) ?? "Someone", toName: nameOf.get(d.toUserId) ?? "Someone" }));

  return {
    household: { id: household.id, name: household.name, currency: household.currency, timezone: tz },
    weekStart,
    label: `${start.toFormat("LLL d")} – ${end.minus({ days: 1 }).toFormat("LLL d")}`,
    ended,
    prevWeek: start.minus({ weeks: 1 }).toISODate()!,
    nextWeek: end <= DateTime.fromJSDate(now).setZone(tz).startOf("week") ? end.toISODate()! : null,
    chores: { people: chores, doneTotal, missedTotal, top },
    money: {
      spentCents,
      expenseCount: expenses.length,
      categories: [...byCategory.entries()].map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents),
      settledCents: settlements.reduce((s, x) => s + x.amountCents, 0),
      settlementCount: settlements.length,
      owes,
    },
    shopping: { purchased },
    upcoming: upcoming.map((o) => ({
      id: o.id, definitionId: o.definition.id, title: o.definition.title, dueAt: o.dueAt, assigneeId: o.assigneeId,
      assigneeName: o.assigneeId ? nameOf.get(o.assigneeId) ?? "Someone" : null,
    })),
  };
}

export async function weeklyRecap(userId: string, householdId: string, week?: string | null, now = new Date()) {
  await requireMember(userId, householdId);
  const h = await prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { timezone: true } });
  return buildRecap(householdId, recapWeekStart(h.timezone, week, now), now);
}

/** One-line summary for a member, used in the notification and email. */
export function recapSummary(r: WeeklyRecap, userId: string) {
  const parts: string[] = [];
  const me = r.chores.people.find((p) => p.userId === userId);
  parts.push(r.chores.doneTotal ? `${r.chores.doneTotal} chore${r.chores.doneTotal === 1 ? "" : "s"} done${me?.done ? ` (${me.done} by you)` : ""}` : "No chores marked done");
  if (r.chores.top) parts.push(r.chores.top.userId === userId ? "you did the most, thank you" : `${r.chores.top.name} did the most`);
  if (r.money.spentCents) parts.push(`${formatCents(r.money.spentCents, r.household.currency)} spent`);
  const mine = r.upcoming.filter((u) => u.assigneeId === userId).length;
  parts.push(mine ? `${mine} chore${mine === 1 ? "" : "s"} coming up for you` : "nothing assigned to you next week");
  const iOwe = r.money.owes.filter((o) => o.fromUserId === userId).reduce((s, o) => s + o.amountCents, 0);
  if (iOwe) parts.push(`you owe ${formatCents(iOwe, r.household.currency)}`);
  const s = parts.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

/**
 * Sunday evening (household time), send each active member one recap notification for the
 * week that is ending. Idempotent: the dedupe key is per household, member and week.
 */
export async function generateWeeklyRecaps(now = new Date()) {
  const households = await prisma.household.findMany({ where: { isDemo: false }, select: { id: true, name: true, timezone: true } });
  let created = 0;
  for (const h of households) {
    const local = DateTime.fromJSDate(now).setZone(h.timezone);
    if (local.weekday !== 7 || local.hour < RECAP_HOUR) continue;
    const weekStart = local.startOf("week").toISODate()!;
    const members = await prisma.membership.findMany({ where: { householdId: h.id, leftAt: null }, select: { userId: true } });
    if (!members.length) continue;
    const recap = await buildRecap(h.id, weekStart, now);
    for (const m of members) {
      const r = await notify({
        userId: m.userId, householdId: h.id, type: "weekly_recap",
        title: `Your week at ${h.name}`, body: recapSummary(recap, m.userId),
        link: `/recap?week=${weekStart}`, dedupeKey: `recap:${h.id}:${m.userId}:${weekStart}`,
      });
      if (r) created++;
    }
  }
  return created;
}
