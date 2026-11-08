import Link from "next/link";
import { DateTime } from "luxon";
import { requireHousehold } from "@/server/session";
import { listOccurrences } from "@/server/tasks";
import { activeMembers } from "@/server/access";
import { computeBalances } from "@/server/expenses";
import { listShopping } from "@/server/shopping";
import { formatCents } from "@/lib/money";
import { TaskList } from "@/components/task-row";
import { QuickAddTask } from "@/components/quick-add";
import { Avatar, EmptyState, LinkButton, Section } from "@/components/ui";

export const metadata = { title: "Home" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default async function HomePage() {
  const { user, household } = await requireHousehold();
  const tz = household.timezone;
  const cur = household.currency;
  const now = DateTime.now().setZone(tz);
  const [pending, members, { balances, suggestions }, { open }] = await Promise.all([
    listOccurrences(user.id, household.id, { status: "PENDING", to: now.plus({ days: 7 }).endOf("day").toJSDate() }),
    activeMembers(household.id),
    computeBalances(user.id, household.id),
    listShopping(user.id, household.id),
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

  return (
    <>
      <div className="relative mb-5 overflow-hidden rounded-[2rem] bg-brand-600 px-5 pb-5 pt-6 text-white shadow-lg shadow-brand-700/15">
        <div className="pointer-events-none absolute -right-12 -top-14 h-28 w-28 rounded-full bg-peach-400/90" aria-hidden />
        <div className="pointer-events-none absolute -bottom-16 right-16 h-32 w-32 rounded-full bg-brand-500/60" aria-hidden />
        <p className="relative text-sm font-medium text-brand-100">{now.toFormat("cccc, LLLL d")}</p>
        <h1 className="relative mt-0.5 text-[1.75rem] font-extrabold leading-tight tracking-tight">{greeting}, {firstName(user.name)}</h1>
        <p className="relative mt-1 text-brand-100">{headline}</p>
        <div className="relative mt-4 flex flex-wrap gap-2 text-sm">
          <Link href="/expenses" className="rounded-full bg-white/15 px-3 py-1.5 font-semibold backdrop-blur hover:bg-white/25">
            💸 {myBalance === 0 ? "All square" : myBalance > 0 ? `You're owed ${formatCents(myBalance, cur)}` : `You owe ${formatCents(-myBalance, cur)}`}
          </Link>
          <Link href="/shopping" className="rounded-full bg-white/15 px-3 py-1.5 font-semibold backdrop-blur hover:bg-white/25">
            🛒 {open.length === 0 ? "Nothing needed" : `${open.length} to buy`}
          </Link>
        </div>
      </div>

      <div className="mb-7"><QuickAddTask /></div>

      {members.length === 1 && (
        <div className="card mb-7 flex items-center gap-3 border-peach-200 bg-peach-50 p-4">
          <span className="text-3xl" aria-hidden>👋</span>
          <p className="flex-1 text-sm"><b>Home is better together.</b> Invite your roommates so chores and costs get shared fairly.</p>
          <LinkButton href="/household#invite" variant="peach">Invite</LinkButton>
        </div>
      )}

      <Section title="Your turn" action={<Link href="/tasks" className="text-sm font-semibold text-brand-700">All chores →</Link>}>
        {mineNow.length === 0 ? (
          <EmptyState icon="🌤️" title="Nothing on your plate today" body={upForGrabs.length > 0 ? "Feeling helpful? There's something up for grabs below." : "Enjoy it. We'll let you know when something comes up."} />
        ) : (
          <TaskList items={mineNow} members={members} tz={tz} currentUserId={user.id} collapseRepeats />
        )}
      </Section>

      {upForGrabs.length > 0 && (
        <Section title="Up for grabs" hint="Nobody's on these yet. Tap “I'll do it” and it's yours.">
          <TaskList items={upForGrabs} members={members} tz={tz} currentUserId={user.id} collapseRepeats />
        </Section>
      )}

      {upcoming.length > 0 && (
        <Section title="Coming up for you">
          <TaskList items={upcoming} members={members} tz={tz} currentUserId={user.id} />
        </Section>
      )}

      <div className="mb-7 grid gap-3 sm:grid-cols-2">
        <Link href="/expenses" className="card block min-w-0 p-4 transition hover:border-brand-200">
          <p className="text-sm font-semibold text-muted">💸 Money</p>
          {myPayments.length === 0 ? (
            <p className="mt-1 font-display text-lg font-bold">You're all square</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {myPayments.map((s) => (
                <li key={`${s.fromUserId}-${s.toUserId}`} className="font-display text-lg font-bold">
                  {s.fromUserId === user.id
                    ? <span className="text-peach-700">You owe {nameOf(s.toUserId)} {formatCents(s.amountCents, cur)}</span>
                    : <span className="text-emerald-700">{nameOf(s.fromUserId)} owes you {formatCents(s.amountCents, cur)}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-sm text-muted">See who paid for what →</p>
        </Link>
        <Link href="/shopping" className="card block min-w-0 p-4 transition hover:border-brand-200">
          <p className="text-sm font-semibold text-muted">🛒 Shopping list</p>
          <p className="mt-1 font-display text-lg font-bold">{open.length === 0 ? "Fridge is stocked" : `${plural(open.length, "thing")} we need`}</p>
          {open.length > 0 && <p className="mt-0.5 truncate text-sm text-muted">{open.slice(0, 4).map((i) => i.name).join(", ")}{open.length > 4 ? "…" : ""}</p>}
          {myShopping > 0 && <p className="mt-1 text-xs font-semibold text-emerald-700">You said you'd pick up {myShopping}</p>}
        </Link>
      </div>

      {members.length > 1 && (
        <Section title="Fair share this week" hint={balanced ? "Nicely balanced. Nobody's carrying the house." : `${firstName(busiest!.name)} has the most on their plate right now.`}>
          <div className="card space-y-3 p-4">
            {workload.map((w) => (
              <div key={w.id} className="flex items-center gap-3">
                <Avatar id={w.id} name={w.name} size="sm" />
                <span className="w-20 truncate text-sm font-medium">{w.id === user.id ? "You" : firstName(w.name)}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                  <div className={`h-full rounded-full ${w.id === user.id ? "bg-brand-500" : "bg-peach-400"}`} style={{ width: `${Math.max(4, (w.minutes / maxMin) * 100)}%` }} />
                </div>
                <span className="w-14 text-right text-xs tabular-nums text-muted">{w.minutes} min</span>
              </div>
            ))}
            {othersLate.length > 0 && (
              <p className="border-t border-slate-100 pt-3 text-sm text-muted">
                Running behind: {othersLate.map((m) => `${firstName(m.name)} (${m.late})`).join(", ")}
              </p>
            )}
            <p className="text-xs text-muted">Estimated minutes of chores assigned for the next 7 days. <Link href="/planner" className="font-semibold text-brand-700">Even it out in the planner →</Link></p>
          </div>
        </Section>
      )}
    </>
  );
}
