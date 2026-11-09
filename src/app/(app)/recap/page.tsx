import Link from "next/link";
import { DateTime } from "luxon";
import { requireHousehold } from "@/server/session";
import { weeklyRecap } from "@/server/recap";
import { formatCents } from "@/lib/money";
import { Avatar, EmptyState, PageHeader, Section } from "@/components/ui";

export const metadata = { title: "Weekly recap" };

export default async function RecapPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const { user, household } = await requireHousehold();
  const r = await weeklyRecap(user.id, household.id, week);
  const cur = r.household.currency;
  const tz = r.household.timezone;
  const maxMin = Math.max(30, ...r.chores.people.map((p) => p.minutes));
  const mine = r.upcoming.filter((u) => u.assigneeId === user.id);
  const open = r.upcoming.filter((u) => u.assigneeId === null);

  return (
    <>
      <PageHeader
        title="Weekly recap"
        subtitle={<>{r.label}{r.ended ? "" : " · so far"}</>}
      />
      <nav className="mb-5 flex items-center justify-between text-sm font-medium" aria-label="Choose week">
        <Link href={`/recap?week=${r.prevWeek}`} className="text-brand-700">← Earlier week</Link>
        {r.nextWeek ? <Link href={`/recap?week=${r.nextWeek}`} className="text-brand-700">Later week →</Link> : <span />}
      </nav>

      <div className="mb-6 grid grid-cols-3 gap-3 text-center">
        <div className="card p-3"><p className="text-2xl font-bold tabular-nums">{r.chores.doneTotal}</p><p className="text-xs text-muted">chores done</p></div>
        <div className="card p-3"><p className="text-2xl font-bold tabular-nums">{formatCents(r.money.spentCents, cur)}</p><p className="text-xs text-muted">spent together</p></div>
        <div className="card p-3"><p className="text-2xl font-bold tabular-nums">{r.shopping.purchased}</p><p className="text-xs text-muted">items bought</p></div>
      </div>

      <Section title="Who did what">
        {r.chores.doneTotal === 0 && r.chores.missedTotal === 0 ? (
          <EmptyState icon="🧹" title="No chores this week" body="Nothing was due or marked done." />
        ) : (
          <div className="card space-y-3 p-4">
            {r.chores.top && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                🏆 {r.chores.top.userId === user.id ? "You" : r.chores.top.name} put in the most time this week. Thank you!
              </p>
            )}
            {r.chores.people.map((p) => (
              <div key={p.userId} className="flex items-center gap-3">
                <Avatar id={p.userId} name={p.name} size="sm" />
                <span className="w-24 truncate text-sm">{p.userId === user.id ? "You" : p.name.split(" ")[0]}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${(p.minutes / maxMin) * 100}%` }} />
                </div>
                <span className="w-28 text-right text-xs tabular-nums text-muted">
                  {p.done} done · {p.minutes} min{p.missed ? ` · ${p.missed} missed` : ""}
                </span>
              </div>
            ))}
            {r.chores.missedTotal > 0 && (
              <p className="text-xs text-muted">{r.chores.missedTotal} still not done. <Link href="/planner#missed" className="font-semibold text-brand-700">Catch up in the planner →</Link></p>
            )}
          </div>
        )}
      </Section>

      <Section title="Money">
        <div className="card space-y-3 p-4 text-sm">
          {r.money.expenseCount === 0 ? (
            <p className="text-muted">No shared expenses this week.</p>
          ) : (
            <ul className="space-y-1">
              {r.money.categories.map((c) => (
                <li key={c.category} className="flex justify-between"><span className="capitalize">{c.category}</span><span className="tabular-nums">{formatCents(c.cents, cur)}</span></li>
              ))}
            </ul>
          )}
          {r.money.settlementCount > 0 && <p className="text-muted">{r.money.settlementCount} payment{r.money.settlementCount === 1 ? "" : "s"} back, {formatCents(r.money.settledCents, cur)} total.</p>}
          <div className="border-t border-slate-100 pt-3">
            <p className="mb-1 font-semibold">Who owes whom right now</p>
            {r.money.owes.length === 0 ? (
              <p className="text-muted">Everyone is settled up.</p>
            ) : (
              <ul className="space-y-1">
                {r.money.owes.map((o) => (
                  <li key={`${o.fromUserId}-${o.toUserId}`} className="flex justify-between">
                    <span>{o.fromUserId === user.id ? "You" : o.fromName} → {o.toUserId === user.id ? "you" : o.toName}</span>
                    <span className="tabular-nums">{formatCents(o.amountCents, cur)}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/expenses" className="mt-2 inline-block text-xs font-semibold text-brand-700">Settle up in Expenses →</Link>
          </div>
        </div>
      </Section>

      <Section title="Coming up in the next 7 days">
        <div className="card p-4 text-sm">
          {mine.length === 0 ? (
            <p className="text-muted">Nothing assigned to you.</p>
          ) : (
            <ul className="space-y-1">
              {mine.map((u) => (
                <li key={u.id} className="flex justify-between gap-3">
                  <Link href={`/tasks/${u.definitionId}`} className="truncate font-medium">{u.title}</Link>
                  <span className="shrink-0 text-muted">{DateTime.fromJSDate(u.dueAt).setZone(tz).toFormat("ccc h:mm a")}</span>
                </li>
              ))}
            </ul>
          )}
          {open.length > 0 && <p className="mt-2 text-muted">{open.length} up for grabs. <Link href="/tasks" className="font-semibold text-brand-700">Pick one up →</Link></p>}
          <p className="mt-2 text-muted">{r.upcoming.length} chore{r.upcoming.length === 1 ? "" : "s"} due across the household.</p>
        </div>
      </Section>
    </>
  );
}
