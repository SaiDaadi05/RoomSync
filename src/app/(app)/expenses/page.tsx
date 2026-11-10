import Link from "next/link";
import { requireHousehold } from "@/server/session";
import { computeBalances, listLedger } from "@/server/expenses";
import { listBills } from "@/server/bills";
import { activeMembers } from "@/server/access";
import { formatCents } from "@/lib/money";
import { niceDate, todayIn } from "@/lib/time";
import { Avatar, EmptyState, LinkButton, PageHeader, Section } from "@/components/ui";
import { SettleForm } from "@/components/settle-form";
import { getPayHandles } from "@/server/payments";
import { payLinks } from "@/lib/pay-links";
import { RemindButton } from "@/components/remind-button";
import { deleteSettlementAction } from "@/app/actions/money";

export const metadata = { title: "Money" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; amount?: string; bill?: string }> }) {
  const { user, household } = await requireHousehold();
  const sp = await searchParams;
  // Add any recurring bills that are due before computing balances.
  const bills = await listBills(user.id, household.id);
  const [{ balances, suggestions }, ledger, members] = await Promise.all([
    computeBalances(user.id, household.id),
    listLedger(user.id, household.id),
    activeMembers(household.id),
  ]);
  const cur = household.currency;
  const isOwner = members.find((m) => m.id === user.id)?.role === "OWNER";
  // Everyone in suggestions has a membership in this household (computeBalances only returns members).
  const handles = await getPayHandles([...new Set(suggestions.filter((s) => s.fromUserId === user.id).map((s) => s.toUserId))]);
  const nameOf = (id: string) => balances.find((b) => b.userId === id)?.name ?? "Someone";
  const mine = balances.find((b) => b.userId === user.id)?.cents ?? 0;
  const mySuggestions = suggestions.filter((s) => s.fromUserId === user.id || s.toUserId === user.id);
  const otherSuggestions = suggestions.filter((s) => s.fromUserId !== user.id && s.toUserId !== user.id);

  return (
    <>
      <PageHeader title="Money" subtitle="Shared costs and who owes whom" action={<LinkButton href="/expenses/new">+ Add a cost</LinkButton>} />

      <div className={`card mb-7 p-5 `}>
        <p className="text-sm text-muted">Your balance</p>
        <p className={`text-3xl font-bold tracking-tight ${mine > 0 ? "text-emerald-700" : ""}`}>
          {mine === 0 ? "You're all square 🎉" : mine > 0 ? `You're owed ${formatCents(mine, cur)}` : `You owe ${formatCents(-mine, cur)}`}
        </p>
        {mySuggestions.length > 0 && (
          <ul className="mt-3 space-y-2">
            {mySuggestions.map((s) => {
              const iPay = s.fromUserId === user.id;
              const other = iPay ? s.toUserId : s.fromUserId;
              const links = iPay ? payLinks(handles.get(other) ?? {}, s.amountCents, `RoomSync: ${household.name}`) : [];
              return (
                <li key={`${s.fromUserId}-${s.toUserId}`} className="border-t border-slate-200 pt-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Avatar id={other} name={nameOf(other)} size="sm" />
                    <span className="min-w-0 flex-1 text-sm">
                      {iPay ? <>Pay <b>{nameOf(other).split(" ")[0]}</b></> : <><b>{nameOf(other).split(" ")[0]}</b> pays you</>} <b className="tabular-nums">{formatCents(s.amountCents, cur)}</b>
                    </span>
                    {!iPay && <RemindButton debtorId={other} name={nameOf(other).split(" ")[0]} />}
                    <Link className={iPay ? "btn-peach min-h-9 px-3.5 text-sm" : "btn-secondary min-h-9 px-3.5 text-sm"} href={`/expenses?from=${s.fromUserId}&to=${s.toUserId}&amount=${(s.amountCents / 100).toFixed(2)}#settle`}>
                      {iPay ? "I paid this" : "They paid me"}
                    </Link>
                  </div>
                  {links.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 pl-11">
                      <span className="text-xs text-muted">Pay with</span>
                      {links.map((l) => (
                        <a key={l.app} href={l.href} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-9 px-3 text-xs">{l.app}</a>
                      ))}
                      <span className="w-full text-xs text-muted">Then tap I paid this so the balance updates.</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Section title="Everyone's balance">
        <ul className="card divide-y divide-slate-100">
          {balances.filter((b) => b.active || b.cents !== 0).map((b) => (
            <li key={b.userId} className="flex items-center gap-3 px-4 py-3">
              <Avatar id={b.userId} name={b.name} />
              <span className="flex-1 font-medium">{b.name}{b.userId === user.id && " (you)"}{!b.active && <span className="text-xs text-muted"> · moved out</span>}</span>
              <span className={`font-semibold tabular-nums ${b.cents > 0 ? "text-emerald-700" : b.cents < 0 ? "text-amber-800" : "text-slate-500"}`}>
                {b.cents > 0 ? `gets back ${formatCents(b.cents, cur)}` : b.cents < 0 ? `owes ${formatCents(-b.cents, cur)}` : "settled"}
              </span>
              {!b.active && b.cents !== 0 && isOwner && (
                <Link href={`/expenses/move-out/${b.userId}`} className="btn-ghost min-h-9 text-xs">Settle up</Link>
              )}
            </li>
          ))}
        </ul>
      </Section>

      {otherSuggestions.length > 0 && (
        <Section title="Between your roommates" hint="The fewest payments that would settle everyone up.">
          <ul className="space-y-2">
            {otherSuggestions.map((s) => (
              <li key={`${s.fromUserId}-${s.toUserId}`} className="card flex items-center gap-3 p-3 text-sm">
                <span className="flex-1"><b>{nameOf(s.fromUserId)}</b> pays <b>{nameOf(s.toUserId)}</b> <span className="tabular-nums">{formatCents(s.amountCents, cur)}</span></span>
                <Link className="btn-ghost min-h-9 text-xs" href={`/expenses?from=${s.fromUserId}&to=${s.toUserId}&amount=${(s.amountCents / 100).toFixed(2)}#settle`}>Record</Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Recurring bills">
        <div id="bills" className="card divide-y divide-slate-100">
          {sp.bill && (
            <p role="status" className="bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
              {sp.bill === "created" ? "Recurring bill added. Any month that's already due was added to Expenses." : "Bill deleted. Months already added stay in Expenses."}
            </p>
          )}
          {bills.map((b) => (
            <Link key={b.id} href={`/expenses/bills/${b.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
              <span className="text-xl" aria-hidden>{b.category === "rent" ? "🏠" : b.category === "internet" ? "📶" : b.category === "utilities" ? "💡" : "🔁"}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{b.description}</p>
                <p className={`text-xs ${b.lastError ? "text-amber-800" : "text-muted"}`}>
                  {b.lastError ? "Needs attention" : b.pausedAt ? "Paused" : `Every month on day ${b.dayOfMonth} · paid by ${nameOf(b.payerId).split(" ")[0]}`}
                </p>
              </div>
              <span className="text-sm font-semibold tabular-nums">{formatCents(b.amountCents, cur)}</span>
            </Link>
          ))}
          <div className="p-4"><Link href="/expenses/bills/new" className="text-sm font-semibold text-brand-700">+ Add a recurring bill (rent, internet, utilities)</Link></div>
        </div>
      </Section>

      <Section title="Record a payment">
        <details id="settle" className="card group p-4" open={Boolean(sp.from || sp.to || sp.amount)}>
          <summary className="cursor-pointer list-none text-sm font-semibold text-brand-700 marker:hidden">
            <span className="group-open:hidden">Paid someone back outside the app? Record it here</span>
            <span className="hidden group-open:inline">Record a payment</span>
          </summary>
          <div className="mt-3">
            <SettleForm key={`${sp.from}-${sp.to}-${sp.amount}`} members={members} from={sp.from ?? user.id} to={sp.to} amount={sp.amount} today={todayIn(household.timezone)} />
          </div>
        </details>
      </Section>

      <Link href="/expenses/insights" className="card mb-7 flex items-center gap-3 p-4 hover:border-slate-400">
        <span className="min-w-0 flex-1"><span className="block font-semibold">Spending insights</span><span className="text-sm text-muted">Monthly totals, your share by category, CSV export</span></span>
        <span className="text-sm font-semibold text-peach-700">Open</span>
      </Link>

      <Section title="Who paid for what">
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
                        {nameOf(entry.expense.payerId)} paid · {niceDate(entry.date)} · <span className="capitalize">{entry.expense.category}</span>
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
                    <p className="text-xs text-muted">Recorded payment · {niceDate(entry.date)}{entry.settlement.note && ` · ${entry.settlement.note}`}</p>
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
