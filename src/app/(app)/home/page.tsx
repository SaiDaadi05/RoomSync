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

  const greeting = now.hour < 5 ? "Up late" : now.hour < 12 ? "Morning" : now.hour < 18 ? "Afternoon" : "Evening";
  const uniqueMine = new Set(mineNow.map((o) => o.definitionId)).size;
  const uniqueLate = new Set(mineLate.map((o) => o.definitionId)).size;
  const headline =
    uniqueMine === 0 ? "You're all caught up." :
    uniqueLate > 0 ? `${plural(uniqueMine, "chore")} for you today, ${uniqueLate} running late.` :
    `${plural(uniqueMine, "chore")} for you today.`;

  const owedLine = myBalance === 0 ? "All square" : myBalance > 0 ? `Owed ${formatCents(myBalance, cur)}` : `You owe ${formatCents(-myBalance, cur)}`;

  return (
    <>
      {/* Greeting, written like a note on the fridge */}
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-[0.14em] text-muted">{now.toFormat("cccc · LLL d")}</p>
        <h1 className="mt-1 text-[2.6rem] font-semibold leading-[1] text-ink">
          {greeting},<br />
          <span className="relative inline-block italic text-brand-600">
            {firstName(user.name)}.
            <svg viewBox="0 0 200 14" preserveAspectRatio="none" className="absolute -bottom-2 left-0 h-3 w-full text-peach-400" aria-hidden>
              <path d="M3 9 C 40 3, 70 12, 105 6 S 170 4, 197 8" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
            </svg>
          </span>
        </h1>
        <p className="mt-4 font-hand text-[1.6rem] font-bold leading-tight text-ink/80">{headline}</p>
      </div>

      {/* Fridge magnets: the two numbers people check most */}
      <div className="mb-7 grid grid-cols-2 gap-3">
        <Link href="/expenses" className={`block min-w-0 -rotate-1 rounded-2xl border-2 border-ink p-3 shadow-[3px_3px_0_var(--color-ink)] transition hover:rotate-0 ${myBalance < 0 ? "bg-peach-300" : myBalance > 0 ? "bg-mint" : "bg-paper"}`}>
          <span className="text-xs font-bold uppercase tracking-wider text-ink/70">Money</span>
          <span className="mt-0.5 block font-display text-xl font-semibold leading-tight">{owedLine}</span>
        </Link>
        <Link href="/shopping" className="block min-w-0 rotate-1 rounded-2xl border-2 border-ink bg-lilac p-3 shadow-[3px_3px_0_var(--color-ink)] transition hover:rotate-0">
          <span className="text-xs font-bold uppercase tracking-wider text-ink/70">Shopping</span>
          <span className="mt-0.5 block font-display text-xl font-semibold leading-tight">{open.length === 0 ? "All stocked" : `${plural(open.length, "thing")} to get`}</span>
        </Link>
      </div>

      <div className="mb-8"><QuickAddTask /></div>

      {members.length === 1 && (
        <div className="card mb-8 flex items-center gap-3 bg-note p-4">
          <p className="flex-1 text-sm"><b>Home is better together.</b> Invite your roommates so chores and costs get shared fairly.</p>
          <LinkButton href="/household#invite" variant="primary">Invite</LinkButton>
        </div>
      )}

      <Section title="Your turn" action={<Link href="/tasks" className="text-sm font-bold text-brand-700 underline decoration-2 underline-offset-4">All chores</Link>}>
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

      <div className="mb-8 grid items-start gap-5 sm:grid-cols-2">
        {/* IOU slip */}
        <Link href="/expenses" className="card relative block min-w-0 p-4 pl-6">
          <span className="absolute inset-y-3 left-2 border-l-2 border-dashed border-ink/30" aria-hidden />
          <p className="font-hand text-2xl font-bold leading-none text-brand-700">IOU</p>
          {myPayments.length === 0 ? (
            <p className="mt-2 font-display text-xl font-semibold">Nobody owes anybody.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {myPayments.map((s) => (
                <li key={`${s.fromUserId}-${s.toUserId}`} className="font-display text-xl font-semibold leading-snug">
                  {s.fromUserId === user.id
                    ? <>You owe {nameOf(s.toUserId)} <span className="whitespace-nowrap bg-peach-300 px-1">{formatCents(s.amountCents, cur)}</span></>
                    : <>{nameOf(s.fromUserId)} owes you <span className="whitespace-nowrap bg-mint px-1">{formatCents(s.amountCents, cur)}</span></>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-sm font-semibold text-muted underline decoration-ink/30 underline-offset-4">Who paid for what</p>
        </Link>

        {/* Sticky note shopping list */}
        <Link href="/shopping" className="relative block min-w-0 rotate-[1.5deg] border-2 border-ink bg-note p-4 pt-5 shadow-[3px_3px_0_var(--color-ink)] transition hover:rotate-0">
          <span className="tape" aria-hidden />
          <p className="font-hand text-2xl font-bold leading-none">We need…</p>
          {open.length === 0 ? (
            <p className="mt-2 font-hand text-xl">nothing! fridge is full</p>
          ) : (
            <ul className="mt-1.5 font-hand text-xl leading-snug">
              {open.slice(0, 5).map((i) => (
                <li key={i.id} className="truncate">– {i.name}{i.claimedById === user.id && <span className="text-emerald-800"> (me)</span>}</li>
              ))}
              {open.length > 5 && <li className="text-ink/60">+ {open.length - 5} more</li>}
            </ul>
          )}
        </Link>
      </div>

      {members.length > 1 && (
        <Section title="Fair share" hint={balanced ? "Nicely balanced this week. Nobody's carrying the house." : `${busiest!.id === user.id ? "You have" : `${firstName(busiest!.name)} has`} the most on their plate this week.`}>
          <div className="card space-y-3.5 p-4">
            {workload.map((w) => (
              <div key={w.id} className="flex items-center gap-3">
                <Avatar id={w.id} name={w.name} size="sm" />
                <span className="w-16 truncate text-sm font-bold">{w.id === user.id ? "You" : firstName(w.name)}</span>
                <div className="h-4 flex-1 overflow-hidden rounded-md border-2 border-ink bg-white" aria-hidden>
                  <div className={`h-full border-r-2 border-ink ${w.id === user.id ? "bg-brand-500" : "bg-peach-400"}`} style={{ width: `${Math.max(4, (w.minutes / maxMin) * 100)}%` }} />
                </div>
                <span className="w-14 text-right text-xs font-bold tabular-nums">{w.minutes} min</span>
              </div>
            ))}
            {othersLate.length > 0 && (
              <p className="border-t-2 border-dashed border-ink/15 pt-3 text-sm">
                <span className="font-hand text-lg font-bold text-rose-700">Running behind:</span> {othersLate.map((m) => `${firstName(m.name)} (${m.late})`).join(", ")}
              </p>
            )}
            <p className="text-xs text-muted">Estimated minutes of chores for the next 7 days. <Link href="/planner" className="font-bold text-brand-700 underline underline-offset-2">Even it out in the planner</Link></p>
          </div>
        </Section>
      )}
    </>
  );
}
