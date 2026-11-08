import Link from "next/link";
import { DateTime } from "luxon";
import { requireHousehold } from "@/server/session";
import { listOccurrences } from "@/server/tasks";
import { activeMembers } from "@/server/access";
import { computeBalances } from "@/server/expenses";
import { listShopping } from "@/server/shopping";
import { formatCents } from "@/lib/money";
import { CategoryIcon, TaskList } from "@/components/task-row";
import { QuickAddTask } from "@/components/quick-add";
import { Avatar, EmptyState, LinkButton, Section } from "@/components/ui";

export const metadata = { title: "Home" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default async function HomePage() {
  const { user, household } = await requireHousehold();
  const tz = household.timezone;
  const cur = household.currency;
  const now = DateTime.now().setZone(tz);
  const [pending, members, { balances, suggestions }, { open }, recentDone] = await Promise.all([
    listOccurrences(user.id, household.id, { status: "PENDING", to: now.plus({ days: 7 }).endOf("day").toJSDate() }),
    activeMembers(household.id),
    computeBalances(user.id, household.id),
    listShopping(user.id, household.id),
    listOccurrences(user.id, household.id, { status: "DONE", from: now.minus({ days: 14 }).toJSDate(), take: 30 }),
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
      {/* Hero: who you are today, at a glance */}
      <div className="relative mb-6 overflow-hidden rounded-[28px] bg-ink px-5 pb-5 pt-6 text-white md:px-8 md:pb-7 md:pt-8">
        <HouseArt className="pointer-events-none absolute right-2 top-3 h-24 w-24 md:-bottom-3 md:right-6 md:top-auto md:h-52 md:w-52" />
        <div className="relative max-w-[calc(100%-5.5rem)] md:max-w-[60%]">
          <p className="text-sm font-semibold text-white/60">{now.toFormat("cccc, LLLL d")}</p>
          <h1 className="mt-1 text-[1.9rem] font-extrabold leading-[1.1] md:text-[2.6rem]">{greeting}, {firstName(user.name)} <span aria-hidden>👋</span></h1>
          <p className="mt-2 text-[15px] text-white/75 md:text-lg">{headline}</p>
        </div>
        <div className="relative mt-5 grid grid-cols-3 gap-2 md:flex md:flex-wrap">
          <Link href="/expenses" className="rounded-2xl bg-peach-400 min-w-0 px-3 py-2.5 transition hover:bg-peach-500 md:px-4">
            <span className="block truncate text-xs font-semibold text-white/85">{moneyLabel}</span>
            <span className="block truncate text-base font-extrabold leading-tight md:text-lg">{moneyValue}</span>
          </Link>
          <Link href="/shopping" className="rounded-2xl bg-white/10 min-w-0 px-3 py-2.5 transition hover:bg-white/15 md:px-4">
            <span className="block truncate text-xs font-semibold text-white/60">To buy</span>
            <span className="block truncate text-base font-extrabold leading-tight md:text-lg">{open.length === 0 ? "All stocked" : plural(open.length, "thing")}</span>
          </Link>
          <Link href="/tasks" className="rounded-2xl bg-white/10 min-w-0 px-3 py-2.5 transition hover:bg-white/15 md:px-4">
            <span className="block truncate text-xs font-semibold text-white/60">Up for grabs</span>
            <span className="block truncate text-base font-extrabold leading-tight md:text-lg">{plural(new Set(upForGrabs.map((o) => o.definitionId)).size, "chore")}</span>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="mb-8"><QuickAddTask /></div>

          {members.length === 1 && (
            <div className="mb-8 flex items-center gap-3 rounded-[20px] bg-peach-100 p-4">
              <p className="flex-1 text-sm"><b>Home is better together.</b> Invite your roommates so chores and costs get shared fairly.</p>
              <LinkButton href="/household#invite" variant="peach">Invite</LinkButton>
            </div>
          )}

          <Section title="Your turn" action={<Link href="/tasks" className="text-sm font-bold text-peach-700">All chores →</Link>}>
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
                    <div key={w.id} className={["bg-peach-400", "bg-ink", "bg-amber-400", "bg-sky-400", "bg-emerald-400", "bg-violet-400"][i % 6]} style={{ width: `${(w.minutes / totalMin) * 100}%` }} />
                  ))}
                </div>
                <ul className="space-y-3">
                  {workload.map((w, i) => {
                    const late = othersLate.find((m) => m.id === w.id)?.late ?? 0;
                    return (
                      <li key={w.id} className="flex items-center gap-3">
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${["bg-peach-400", "bg-ink", "bg-amber-400", "bg-sky-400", "bg-emerald-400", "bg-violet-400"][i % 6]}`} aria-hidden />
                        <Avatar id={w.id} name={w.name} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-sm font-bold">
                          {w.id === user.id ? "You" : firstName(w.name)}
                          {late > 0 && <span className="ml-1.5 text-xs font-semibold text-peach-700">{late} late</span>}
                        </span>
                        <span className="text-sm font-extrabold tabular-nums">{Math.round((w.minutes / totalMin) * 100)}%</span>
                        <span className="w-12 text-right text-xs tabular-nums text-muted">{w.minutes}m</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-4 border-t border-slate-200 pt-3 text-xs text-muted">Share of estimated chore time, next 7 days. <Link href="/planner" className="font-bold text-ink underline underline-offset-2">Even it out</Link></p>
              </div>
            </Section>
          )}

          <Section title="Shopping list" action={<Link href="/shopping" className="text-sm font-bold text-peach-700">Open →</Link>}>
            <div className="card p-4">
              {open.length === 0 ? (
                <p className="text-sm text-muted">Nothing needed right now. Add things as they run low.</p>
              ) : (
                <ul className="space-y-2">
                  {open.slice(0, 5).map((i) => (
                    <li key={i.id} className="flex items-center gap-3 text-sm">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-peach-400" aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-semibold">{i.name}</span>
                      {i.claimedById && <span className="text-xs text-muted">{i.claimedById === user.id ? "you're getting it" : `${nameOf(i.claimedById)}'s getting it`}</span>}
                    </li>
                  ))}
                  {open.length > 5 && <li className="pl-5 text-xs font-semibold text-muted">+ {open.length - 5} more</li>}
                </ul>
              )}
              {myShopping > 0 && <p className="mt-3 text-xs font-semibold text-peach-700">You said you'd pick up {myShopping}.</p>}
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
        </aside>
      </div>
    </div>
  );
}

/** Little illustrated house for the Home hero: navy-on-navy with coral roof and lit windows. */
function HouseArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden>
      <circle cx="150" cy="48" r="18" fill="#ffd8a8" />
      <path d="M30 100 100 42l70 58" fill="#ff6b4a" />
      <path d="M44 96h112v96H44z" fill="#2c3c63" />
      <path d="M30 100 100 42l70 58" fill="none" stroke="#ff6b4a" strokeWidth="14" strokeLinejoin="round" strokeLinecap="round" />
      <rect x="62" y="114" width="28" height="26" rx="5" fill="#ffd8a8" />
      <rect x="110" y="114" width="28" height="26" rx="5" fill="#ffd8a8" />
      <path d="M76 114v26M62 127h28M124 114v26M110 127h28" stroke="#2c3c63" strokeWidth="3" />
      <rect x="86" y="152" width="28" height="40" rx="6" fill="#ff6b4a" />
      <circle cx="107" cy="173" r="2.5" fill="#14213d" />
      <path d="M128 62V44h14v30" fill="#2c3c63" />
    </svg>
  );
}
