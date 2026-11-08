import Link from "next/link";
import { requireHousehold } from "@/server/session";
import { computeBalances, listLedger } from "@/server/expenses";
import { activeMembers } from "@/server/access";
import { formatCents } from "@/lib/money";
import { todayIn } from "@/lib/time";
import { Avatar, EmptyState, LinkButton, PageHeader, Section } from "@/components/ui";
import { SettleForm } from "@/components/settle-form";
import { deleteSettlementAction } from "@/app/actions/money";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; amount?: string }> }) {
  const { user, household } = await requireHousehold();
  const sp = await searchParams;
  const [{ balances, suggestions }, ledger, members] = await Promise.all([
    computeBalances(user.id, household.id),
    listLedger(user.id, household.id),
    activeMembers(household.id),
  ]);
  const cur = household.currency;
  const nameOf = (id: string) => balances.find((b) => b.userId === id)?.name ?? "Someone";
  const mine = balances.find((b) => b.userId === user.id)?.cents ?? 0;

  return (
    <>
      <PageHeader title="Expenses" action={<LinkButton href="/expenses/new">+ Expense</LinkButton>} />
      <Link href="/expenses/insights" className="card mb-4 flex items-center gap-3 p-4 hover:border-brand-200">
        <span className="text-2xl" aria-hidden>📊</span>
        <span className="flex-1"><span className="block font-semibold">Spending insights</span><span className="text-sm text-muted">Monthly totals, your share by category, CSV export</span></span>
        <span className="text-brand-700" aria-hidden>→</span>
      </Link>

      <div className={`card mb-4 p-5 ${mine > 0 ? "bg-emerald-50" : mine < 0 ? "bg-amber-50" : ""}`}>
        <p className="text-sm text-muted">Your balance</p>
        <p className="text-3xl font-bold tracking-tight">
          {mine === 0 ? "All settled up" : mine > 0 ? `You're owed ${formatCents(mine, cur)}` : `You owe ${formatCents(-mine, cur)}`}
        </p>
      </div>

      <Section title="Balances">
        <ul className="card divide-y divide-slate-100">
          {balances.filter((b) => b.active || b.cents !== 0).map((b) => (
            <li key={b.userId} className="flex items-center gap-3 px-4 py-3">
              <Avatar id={b.userId} name={b.name} />
              <span className="flex-1 font-medium">{b.name}{b.userId === user.id && " (you)"}{!b.active && <span className="text-xs text-muted"> · moved out</span>}</span>
              <span className={`font-semibold tabular-nums ${b.cents > 0 ? "text-emerald-700" : b.cents < 0 ? "text-amber-800" : "text-slate-500"}`}>
                {b.cents > 0 ? `gets back ${formatCents(b.cents, cur)}` : b.cents < 0 ? `owes ${formatCents(-b.cents, cur)}` : "settled"}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {suggestions.length > 0 && (
        <Section title="Suggested payments to settle up">
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li key={`${s.fromUserId}-${s.toUserId}`} className="card flex items-center gap-3 p-3 text-sm">
                <span className="flex-1"><b>{nameOf(s.fromUserId)}</b> pays <b>{nameOf(s.toUserId)}</b> <span className="tabular-nums">{formatCents(s.amountCents, cur)}</span></span>
                <Link className="btn-ghost min-h-9 text-xs" href={`/expenses?from=${s.fromUserId}&to=${s.toUserId}&amount=${(s.amountCents / 100).toFixed(2)}#settle`}>Record</Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Record a payment">
        <div id="settle" className="card p-4">
          <SettleForm key={`${sp.from}-${sp.to}-${sp.amount}`} members={members} from={sp.from ?? user.id} to={sp.to} amount={sp.amount} today={todayIn(household.timezone)} />
        </div>
      </Section>

      <Section title="History">
        {ledger.length === 0 ? (
          <EmptyState icon="🧾" title="No expenses yet" body="Log shared costs like groceries, utilities, or that new shower curtain. RoomSync keeps a running tab." action={<LinkButton href="/expenses/new">Add the first expense</LinkButton>} />
        ) : (
          <ul className="card divide-y divide-slate-100">
            {ledger.map((entry) =>
              entry.kind === "expense" ? (
                <li key={entry.expense.id}>
                  <Link href={`/expenses/${entry.expense.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <span aria-hidden className="text-xl">🧾</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{entry.expense.description}</p>
                      <p className="text-xs text-muted">
                        {nameOf(entry.expense.payerId)} paid · {entry.date} · <span className="capitalize">{entry.expense.category}</span>
                        {entry.expense.receiptKey && " · 📎"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular-nums">{formatCents(entry.expense.amountCents, cur)}</p>
                      {(() => {
                        const share = entry.expense.splits.find((s) => s.userId === user.id)?.amountCents ?? 0;
                        const net = (entry.expense.payerId === user.id ? entry.expense.amountCents : 0) - share;
                        return <p className={`text-xs ${net > 0 ? "text-emerald-700" : net < 0 ? "text-amber-800" : "text-muted"}`}>{net > 0 ? `you lent ${formatCents(net, cur)}` : net < 0 ? `you owe ${formatCents(-net, cur)}` : "not involved"}</p>;
                      })()}
                    </div>
                  </Link>
                </li>
              ) : (
                <li key={entry.settlement.id} className="flex items-center gap-3 px-4 py-3">
                  <span aria-hidden className="text-xl">🤝</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{nameOf(entry.settlement.fromUserId)} paid {nameOf(entry.settlement.toUserId)}</p>
                    <p className="text-xs text-muted">Recorded payment · {entry.date}{entry.settlement.note && ` · ${entry.settlement.note}`}</p>
                  </div>
                  <p className="font-semibold tabular-nums text-slate-600">{formatCents(entry.settlement.amountCents, cur)}</p>
                  <form action={deleteSettlementAction}><input type="hidden" name="id" value={entry.settlement.id} />
                    <button className="text-xs text-slate-500 hover:text-red-700" aria-label="Delete recorded payment">✕</button>
                  </form>
                </li>
              ),
            )}
          </ul>
        )}
      </Section>
    </>
  );
}
