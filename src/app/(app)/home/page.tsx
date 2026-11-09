import Link from "next/link";
import { DateTime } from "luxon";
import { requireHousehold } from "@/server/session";
import { listOccurrences } from "@/server/tasks";
import { activeMembers } from "@/server/access";
import { computeBalances } from "@/server/expenses";
import { listShopping } from "@/server/shopping";
import { listSwapRequests } from "@/server/planner";
import { formatCents } from "@/lib/money";
import { CategoryIcon, TaskList } from "@/components/task-row";
import { QuickAddTask } from "@/components/quick-add";
import { InstallPrompt } from "@/components/pwa";
import { Avatar, EmptyState, LinkButton, Section } from "@/components/ui";

export const metadata = { title: "Home" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default async function HomePage() {
  const { user, household } = await requireHousehold();
  const tz = household.timezone;
  const cur = household.currency;
  const now = DateTime.now().setZone(tz);
  const [pending, members, { balances, suggestions }, { open }, recentDone, swaps] = await Promise.all([
    listOccurrences(user.id, household.id, { status: "PENDING", to: now.plus({ days: 7 }).endOf("day").toJSDate() }),
    activeMembers(household.id),
    computeBalances(user.id, household.id),
    listShopping(user.id, household.id),
    listOccurrences(user.id, household.id, { status: "DONE", from: now.minus({ days: 14 }).toJSDate(), take: 30 }),
    listSwapRequests(user.id, household.id),
  ]);
  const nowJs = now.toJSDate();
  const endToday = now.endOf("day").toJSDate();
  const in3 = now.plus({ days: 3 }).endOf("day").toJSDate();
  const firstName = (name: string) => name.split(" ")[0];
  const nameOf = (id: string) => firstName(members.find((m) => m.id === id)?.name ?? balances.find((b) => b.userId === id)?.name ?? "Someone");

  // What's on my plate: late + due today, mine first. Unclaimed chores are their own "up for grabs" group.
  const dueByToday = pending.filter((o) => o.dueAt <= endToday);
  const mineNow = dueByToday.filter((o) => o.assigneeId === user.id);
  const mineLate = mineNow.filter((o) => o.dueAt < nowJs);
  const upForGrabs = dueByToday.filter((o) => o.assigneeId === null);
  const upcoming = pending.filter((o) => o.dueAt > endToday && o.dueAt <= in3 && o.assigneeId === user.id);
  const othersLate = members
    .filter((m) => m.id !== user.id)
    .map((m) => ({ ...m, late: new Set(pending.filter((o) => o.assigneeId === m.id && o.dueAt < nowJs).map((o) => o.definitionId)).size }))
    .filter((m) => m.late > 0);

  const myBalance = balances.find((b) => b.userId === user.id)?.cents ?? 0;
  const myPayments = suggestions.filter((s) => s.fromUserId === user.id || s.toUserId === user.id);
  const myShopping = open.filter((i) => i.claimedById === user.id).length;

  const workload = members.map((m) => ({
    ...m,
    minutes: pending.filter((o) => o.assigneeId === m.id).reduce((s, o) => s + o.definition.estimatedMinutes, 0),
  }));
  const maxMin = Math.max(30, ...workload.map((w) => w.minutes));
  const minMin = Math.min(...workload.map((w) => w.minutes));
  const busiest = [...workload].sort((a, b) => b.minutes - a.minutes)[0];
  const balanced = maxMin - minMin <= 20;

  const greeting = now.hour < 5 ? "Hey night owl" : now.hour < 12 ? "Good morning" : now.hour < 18 ? "Good afternoon" : "Good evening";
  const uniqueMine = new Set(mineNow.map((o) => o.definitionId)).size;
  const uniqueLate = new Set(mineLate.map((o) => o.definitionId)).size;
  const headline =
    uniqueMine === 0 ? "You're all caught up." :
    uniqueLate > 0 ? `${plural(uniqueMine, "chore")} for you today, ${uniqueLate} running late.` :
    `${plural(uniqueMine, "chore")} for you today.`;

  const firstPayment = myPayments[0];
  const moneyLabel = !firstPayment ? "Money" : firstPayment.fromUserId === user.id ? `You owe ${nameOf(firstPayment.toUserId)}` : `${nameOf(firstPayment.fromUserId)} owes you`;
  const moneyValue = !firstPayment ? "All square" : formatCents(firstPayment.amountCents, cur);

  const totalMin = workload.reduce((t, w) => t + w.minutes, 0) || 1;
  const activity = recentDone
    .filter((o) => o.completedAt && o.completedById)
    .sort((x, y) => y.completedAt!.getTime() - x.completedAt!.getTime())
    .slice(0, 5);
  const ago = (d: Date) => DateTime.fromJSDate(d).setZone(tz).toRelative({ base: now }) ?? "";

  return (
    <div data-wide>
      {/* Header: the day, who lives here, and the three numbers people check most */}
      <div className="mb-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">{now.toFormat("cccc, LLLL d")} · {plural(members.length, "roommate")}</p>
          <div className="flex -space-x-2" aria-label={members.map((m) => m.name).join(", ")}>
            {members.slice(0, 5).map((m) => <Avatar key={m.id} id={m.id} name={m.name} size="sm" />)}
          </div>
        </div>
        <h1 className="mt-1 text-[1.9rem] font-bold leading-tight md:text-[2.25rem]">{greeting}, {firstName(user.name)}</h1>
        <p className="mt-1 text-[15px] text-muted">{headline}</p>
      </div>

      <InstallPrompt />

      {swaps.incoming.length > 0 && (
        <Link href="/planner#swaps" className="card mb-6 flex items-center gap-3 p-4 hover:border-slate-300">
          <p className="flex-1 text-sm font-medium">{swaps.incoming.length === 1 ? "A roommate wants to swap a task with you" : `${swaps.incoming.length} roommates want to swap tasks with you`}</p>
          <span className="text-sm font-semibold text-peach-700">Review</span>
        </Link>
      )}

      <div className="mb-8 grid grid-cols-3 gap-2.5 md:max-w-2xl md:gap-3">
        <Link href="/expenses" className="card block min-w-0 p-3 transition hover:shadow-[0_6px_16px_rgba(0,0,0,0.12)] md:p-4">
          <span className="block truncate text-[13px] text-muted">{moneyLabel}</span>
          <span className={`mt-0.5 block truncate text-lg font-bold md:text-xl ${firstPayment && firstPayment.fromUserId !== user.id ? "text-emerald-700" : ""}`}>{moneyValue}</span>
        </Link>
        <Link href="/shopping" className="card block min-w-0 p-3 transition hover:shadow-[0_6px_16px_rgba(0,0,0,0.12)] md:p-4">
          <span className="block truncate text-[13px] text-muted">To buy</span>
          <span className="mt-0.5 block truncate text-lg font-bold md:text-xl">{open.length === 0 ? "Nothing" : plural(open.length, "item")}</span>
        </Link>
        <Link href="/planner" className="card block min-w-0 p-3 transition hover:shadow-[0_6px_16px_rgba(0,0,0,0.12)] md:p-4">
          <span className="block truncate text-[13px] text-muted">Your share</span>
          <span className="mt-0.5 block truncate text-lg font-bold md:text-xl">{Math.round(((workload.find((w) => w.id === user.id)?.minutes ?? 0) / totalMin) * 100)}%</span>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-x-12 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div className="mb-8"><QuickAddTask today={now.toISODate()!} tz={tz} currentUserId={user.id} members={members.map((m) => ({ id: m.id, name: m.name }))} /></div>

          {members.length === 1 && (
            <div className="card mb-8 flex items-center gap-3 p-4">
              <p className="flex-1 text-sm"><b>Home is better together.</b> Invite your roommates so chores and costs get shared fairly.</p>
              <LinkButton href="/household#invite" variant="peach">Invite</LinkButton>
            </div>
          )}

          <Section title="Your turn" action={<Link href="/tasks" className="text-sm font-semibold underline underline-offset-4">Show all</Link>}>
            {mineNow.length === 0 ? (
              <EmptyState icon="☕" title="Nothing on your plate today" body={upForGrabs.length > 0 ? "Feeling helpful? There's something up for grabs below." : "Put your feet up. We'll tell you when something comes up."} />
            ) : (
              <TaskList items={mineNow} members={members} tz={tz} currentUserId={user.id} collapseRepeats />
            )}
          </Section>

          {upForGrabs.length > 0 && (
            <Section title="Up for grabs" hint="Nobody's on these yet. Claim one and it's yours.">
              <TaskList items={upForGrabs} members={members} tz={tz} currentUserId={user.id} collapseRepeats />
            </Section>
          )}

          {upcoming.length > 0 && (
            <Section title="Coming up for you">
              <TaskList items={upcoming} members={members} tz={tz} currentUserId={user.id} />
            </Section>
          )}
        </div>

        <aside className="min-w-0">
          {members.length > 1 && (
            <Section title="Who's doing what" hint={balanced ? "Nicely balanced this week." : `${busiest!.id === user.id ? "You have" : `${firstName(busiest!.name)} has`} the most on their plate.`}>
              <div className="card p-4">
                <div className="mb-4 flex h-3 overflow-hidden rounded-full" aria-hidden>
                  {workload.map((w, i) => (
                    <div key={w.id} className={(w.id === user.id ? "bg-peach-400" : ["bg-ink", "bg-slate-400", "bg-slate-300", "bg-slate-500"][i % 4])} style={{ width: `${(w.minutes / totalMin) * 100}%` }} />
                  ))}
                </div>
                <ul className="space-y-3">
                  {workload.map((w, i) => {
                    const late = othersLate.find((m) => m.id === w.id)?.late ?? 0;
                    return (
                      <li key={w.id} className="flex items-center gap-3">
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${(w.id === user.id ? "bg-peach-400" : ["bg-ink", "bg-slate-400", "bg-slate-300", "bg-slate-500"][i % 4])}`} aria-hidden />
                        <Avatar id={w.id} name={w.name} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {w.id === user.id ? "You" : firstName(w.name)}
                          {late > 0 && <span className="ml-1.5 text-xs font-normal text-peach-700">{late} late</span>}
                        </span>
                        <span className="text-sm font-semibold tabular-nums">{Math.round((w.minutes / totalMin) * 100)}%</span>
                        <span className="w-12 text-right text-xs tabular-nums text-muted">{w.minutes}m</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-4 border-t border-slate-200 pt-3 text-xs text-muted">Share of estimated chore time, next 7 days. <Link href="/planner" className="font-semibold text-ink underline underline-offset-2">Even it out</Link></p>
              </div>
            </Section>
          )}

          <Section title="Shopping list" action={<Link href="/shopping" className="text-sm font-semibold underline underline-offset-4">Open list</Link>}>
            <div className="card p-4">
              {open.length === 0 ? (
                <p className="text-sm text-muted">Nothing needed right now. Add things as they run low.</p>
              ) : (
                <ul className="space-y-2.5">
                  {open.slice(0, 5).map((i) => (
                    <li key={i.id} className="flex items-center gap-3 text-sm">
                      <span className="h-4 w-4 shrink-0 rounded border border-slate-400" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{i.name}</span>
                      {i.claimedById && <span className="text-xs text-muted">{i.claimedById === user.id ? "you're getting it" : `${nameOf(i.claimedById)}'s getting it`}</span>}
                    </li>
                  ))}
                  {open.length > 5 && <li className="pl-5 text-xs font-semibold text-muted">+ {open.length - 5} more</li>}
                </ul>
              )}
              {myShopping > 0 && <p className="mt-3 text-xs text-muted">You said you'd pick up {myShopping}.</p>}
            </div>
          </Section>

          {activity.length > 0 && (
            <Section title="Recently done">
              <ul className="card divide-y divide-slate-200">
                {activity.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 px-4 py-3">
                    <CategoryIcon category={o.definition.category} className="h-9 w-9" />
                    <p className="min-w-0 flex-1 text-sm">
                      <b>{o.completedById === user.id ? "You" : nameOf(o.completedById!)}</b> did <span className="font-semibold">{o.definition.title.toLowerCase()}</span>
                      <span className="block text-xs text-muted">{ago(o.completedAt!)}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Link href="/recap" className="card flex min-w-0 items-center gap-3 p-4 hover:border-slate-400">
            <span className="min-w-0 flex-1"><span className="block font-semibold">Weekly recap</span><span className="text-sm text-muted">Who did what, what you spent, and what&apos;s next</span></span>
            <span className="text-sm font-semibold text-peach-700">Open</span>
          </Link>
        </aside>
      </div>
    </div>
  );
}
