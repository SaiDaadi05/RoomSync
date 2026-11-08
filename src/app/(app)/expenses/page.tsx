import Link from "next/link";
import { requireHousehold } from "@/server/session";
import { computeBalances, listLedger } from "@/server/expenses";
import { activeMembers } from "@/server/access";
import { formatCents } from "@/lib/money";
import { todayIn } from "@/lib/time";
import { Avatar, EmptyState, LinkButton, PageHeader, Section } from "@/components/ui";
import { SettleForm } from "@/components/settle-form";
import { getPayHandles } from "@/server/payments";
import { payLinks } from "@/lib/pay-links";
import { RemindButton } from "@/components/remind-button";
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
  // Everyone in suggestions has a membership in this household (computeBalances only returns members).
  const handles = await getPayHandles([...new Set(suggestions.filter((s) => s.fromUserId === user.id).map((s) => s.toUserId))]);
  const nameOf = (id: string) => balances.find((b) => b.userId === id)?.name ?? "Someone";
  const mine = balances.find((b) => b.userId === user.id)?.cents ?? 0;

  return (
    <>
      <PageHeader title="Expenses" action={<LinkButton href="/expenses/new">+ Expense</LinkButton>} />

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
            {suggestions.map((s) => {
              const links = s.fromUserId === user.id ? payLinks(handles.get(s.toUserId) ?? {}, s.amountCents, `RoomSync: ${household.name}`) : [];
              return (
                <li key={`${s.fromUserId}-${s.toUserId}`} className="card p-3 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="flex-1"><b>{s.fromUserId === user.id ? "You" : nameOf(s.fromUserId)}</b> {s.fromUserId === user.id ? "pay" : "pays"} <b>{s.toUserId === user.id ? "you" : nameOf(s.toUserId)}</b> <span className="tabular-nums">{formatCents(s.amountCents, cur)}</span></span>
                    {s.toUserId === user.id && <RemindButton debtorId={s.fromUserId} name={nameOf(s.fromUserId).split(" ")[0]} />}
                    <Link className="btn-ghost min-h-9 text-xs" href={`/expenses?from=${s.fromUserId}&to=${s.toUserId}&amount=${(s.amountCents / 100).toFixed(2)}#settle`}>Record</Link>
                  </div>
                  {links.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted">Pay with</span>
                      {links.map((l) => (
                        <a key={l.app} href={l.href} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-9 px-3 text-xs">{l.app}</a>
                      ))}
                      <span className="w-full text-xs text-muted">Then tap Record so the balance updates.</span>
                    </div>
                  )}
                </li>
              );
            })}
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
