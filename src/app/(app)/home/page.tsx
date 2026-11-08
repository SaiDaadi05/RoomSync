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
import { EmptyState, LinkButton, Section } from "@/components/ui";

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

  const firstPayment = myPayments[0];
  const moneyLabel = !firstPayment ? "Money" : firstPayment.fromUserId === user.id ? `You owe ${nameOf(firstPayment.toUserId)}` : `${nameOf(firstPayment.fromUserId)} owes you`;
  const moneyValue = !firstPayment ? "All square" : formatCents(firstPayment.amountCents, cur);

  return (
    <>
      <div className="mb-5">
        <p className="text-sm font-semibold text-muted">{now.toFormat("cccc, LLLL d")}</p>
        <h1 className="mt-0.5 text-[1.9rem] font-extrabold leading-tight">{greeting}, {firstName(user.name)}</h1>
        <p className="mt-1 text-[15px] text-muted">{headline}</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3">
        <Link href="/expenses" className="block min-w-0 rounded-[20px] bg-ink p-4 text-white transition active:scale-[.98]">
          <span className="block truncate text-xs font-semibold text-white/75">{moneyLabel}</span>
          <span className="mt-0.5 block text-xl font-extrabold">{moneyValue}</span>
          {myPayments.length > 1 && <span className="mt-0.5 block text-xs text-white/75">+{myPayments.length - 1} more</span>}
        </Link>
        <Link href="/shopping" className="card block min-w-0 p-4 transition active:scale-[.98]">
          <span className="block text-xs font-semibold text-muted">Shopping list</span>
          <span className="mt-0.5 block text-xl font-extrabold">{open.length === 0 ? "All stocked" : plural(open.length, "thing")}</span>
          {myShopping > 0 && <span className="mt-0.5 block text-xs font-semibold text-peach-700">You're getting {myShopping}</span>}
        </Link>
      </div>

      <div className="mb-8"><QuickAddTask /></div>

      {members.length === 1 && (
        <div className="mb-8 flex items-center gap-3 rounded-[20px] bg-peach-100 p-4">
          <p className="flex-1 text-sm"><b>Home is better together.</b> Invite your roommates so chores and costs get shared fairly.</p>
          <LinkButton href="/household#invite" variant="peach">Invite</LinkButton>
        </div>
      )}

      <Section title="Your turn" action={<Link href="/tasks" className="text-sm font-bold text-ink">All chores</Link>}>
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

      {members.length > 1 && (
        <Section title="Fair share this week" hint={balanced ? "Nicely balanced. Nobody's carrying the house." : `${busiest!.id === user.id ? "You have" : `${firstName(busiest!.name)} has`} the most on their plate right now.`}>
          <div className="card space-y-3.5 p-4">
            {workload.map((w) => (
              <div key={w.id} className="flex items-center gap-3">
                <span className="w-16 truncate text-sm font-bold">{w.id === user.id ? "You" : firstName(w.name)}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                  <div className={`h-full rounded-full ${w.id === user.id ? "bg-peach-400" : "bg-ink"}`} style={{ width: `${Math.max(4, (w.minutes / maxMin) * 100)}%` }} />
                </div>
                <span className="w-14 text-right text-sm font-bold tabular-nums">{w.minutes}m</span>
              </div>
            ))}
            {othersLate.length > 0 && (
              <p className="border-t border-slate-200 pt-3 text-sm text-muted">
                <b className="text-peach-500">Running behind:</b> {othersLate.map((m) => `${firstName(m.name)} (${m.late})`).join(", ")}
              </p>
            )}
            <p className="text-xs text-muted">Estimated minutes of chores for the next 7 days. <Link href="/planner" className="font-bold text-ink underline underline-offset-2">Even it out in the planner</Link></p>
          </div>
        </Section>
      )}
    </>
  );
}
