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

export default async function HomePage() {
  const { user, household } = await requireHousehold();
  const tz = household.timezone;
  const now = DateTime.now().setZone(tz);
  const [pending, members, { balances }, { open }] = await Promise.all([
    listOccurrences(user.id, household.id, { status: "PENDING", to: now.plus({ days: 7 }).endOf("day").toJSDate() }),
    activeMembers(household.id),
    computeBalances(user.id, household.id),
    listShopping(user.id, household.id),
  ]);
  const nowJs = now.toJSDate();
  const endToday = now.endOf("day").toJSDate();
  const in3 = now.plus({ days: 3 }).endOf("day").toJSDate();
  const relevant = (o: (typeof pending)[number]) => o.assigneeId === user.id || o.assigneeId === null;
  const overdue = pending.filter((o) => o.dueAt < nowJs);
  const today = pending.filter((o) => o.dueAt >= nowJs && o.dueAt <= endToday && relevant(o));
  const upcoming = pending.filter((o) => o.dueAt > endToday && o.dueAt <= in3 && o.assigneeId === user.id);
  const myBalance = balances.find((b) => b.userId === user.id)?.cents ?? 0;
  const workload = members.map((m) => ({
    ...m,
    minutes: pending.filter((o) => o.assigneeId === m.id).reduce((s, o) => s + o.definition.estimatedMinutes, 0),
  }));
  const maxMin = Math.max(30, ...workload.map((w) => w.minutes));
  const greeting = now.hour < 12 ? "Good morning" : now.hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <div className="mb-4">
        <p className="text-sm text-muted">{now.toFormat("cccc, LLLL d")}</p>
        <h1 className="text-2xl font-bold tracking-tight">{greeting}, {user.name.split(" ")[0]}</h1>
      </div>
      <div className="mb-6"><QuickAddTask /></div>

      {members.length === 1 && (
        <div className="card mb-6 flex items-center gap-3 border-brand-200 bg-brand-50 p-4">
          <span className="text-2xl" aria-hidden>👋</span>
          <p className="flex-1 text-sm">RoomSync works best with everyone in. Invite your roommates to share chores and costs.</p>
          <LinkButton href="/household#invite">Invite</LinkButton>
        </div>
      )}

      {overdue.length > 0 && (
        <Section title={`Overdue · ${overdue.length}`}>
          <TaskList items={overdue} members={members} tz={tz} currentUserId={user.id} />
        </Section>
      )}
      <Section title="Today" action={<Link href="/tasks" className="text-xs font-semibold text-brand-700">All tasks →</Link>}>
        {today.length === 0 ? (
          <EmptyState icon="🌤️" title="You're clear for today" body="Nothing due for you or up for grabs today." />
        ) : (
          <TaskList items={today} members={members} tz={tz} currentUserId={user.id} />
        )}
      </Section>
      {upcoming.length > 0 && (
        <Section title="Your next 3 days">
          <TaskList items={upcoming} members={members} tz={tz} currentUserId={user.id} />
        </Section>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/shopping" className="card block p-4 hover:border-brand-200">
          <p className="text-sm font-semibold text-muted">🛒 Shopping</p>
          <p className="mt-1 text-lg font-bold">{open.length === 0 ? "Nothing needed" : `${open.length} item${open.length === 1 ? "" : "s"} needed`}</p>
          {open.length > 0 && <p className="mt-1 truncate text-sm text-muted">{open.slice(0, 4).map((i) => i.name).join(", ")}{open.length > 4 ? "…" : ""}</p>}
          {open.some((i) => i.claimedById === user.id) && <p className="mt-1 text-xs font-medium text-emerald-700">You said you'd buy {open.filter((i) => i.claimedById === user.id).length}</p>}
        </Link>
        <Link href="/expenses" className="card block p-4 hover:border-brand-200">
          <p className="text-sm font-semibold text-muted">💸 Balance</p>
          <p className={`mt-1 text-lg font-bold ${myBalance > 0 ? "text-emerald-700" : myBalance < 0 ? "text-amber-800" : ""}`}>
            {myBalance === 0 ? "All settled up" : myBalance > 0 ? `You're owed ${formatCents(myBalance, household.currency)}` : `You owe ${formatCents(-myBalance, household.currency)}`}
          </p>
          <p className="mt-1 text-sm text-muted">Tap to see who owes whom</p>
        </Link>
      </div>

      {members.length > 1 && (
        <Section title="Workload next 7 days">
          <div className="card space-y-3 p-4">
            {workload.map((w) => (
              <div key={w.id} className="flex items-center gap-3">
                <Avatar id={w.id} name={w.name} size="sm" />
                <span className="w-20 truncate text-sm">{w.name.split(" ")[0]}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${(w.minutes / maxMin) * 100}%` }} />
                </div>
                <span className="w-16 text-right text-xs tabular-nums text-muted">{w.minutes} min</span>
              </div>
            ))}
            <p className="text-xs text-muted">Based on estimated minutes of assigned tasks. <Link href="/planner" className="font-semibold text-brand-700">Balance it in the planner →</Link></p>
          </div>
        </Section>
      )}
    </>
  );
}
