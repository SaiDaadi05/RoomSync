import Link from "next/link";
import { requireHousehold } from "@/server/session";
import { spendingInsights } from "@/server/insights";
import { formatCents } from "@/lib/money";
import { EmptyState, PageHeader, Section } from "@/components/ui";

export const metadata = { title: "Spending insights" };

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month } = await searchParams;
  const { user, household } = await requireHousehold();
  const r = await spendingInsights(user.id, household.id, month);
  const cur = household.currency;
  const money = (c: number) => formatCents(c, cur);
  const maxTrend = Math.max(1, ...r.trend.map((t) => t.total));
  const maxCat = Math.max(1, ...r.categories.map((c) => c.total));

  return (
    <>
      <Link href="/expenses" className="mb-3 inline-block text-sm font-medium text-brand-700">← Expenses</Link>
      <PageHeader title="Spending insights" subtitle={r.label} action={<a href="/api/expenses/export" className="btn-secondary min-h-9 text-xs" download>Export CSV</a>} />
      <nav className="mb-5 flex items-center justify-between text-sm font-medium" aria-label="Choose month">
        <Link href={`/expenses/insights?month=${r.prevMonth}`} className="text-brand-700">← Earlier</Link>
        {r.nextMonth ? <Link href={`/expenses/insights?month=${r.nextMonth}`} className="text-brand-700">Later →</Link> : <span />}
      </nav>

      <div className="mb-6 grid grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="text-xs text-muted">Household spent</p>
          <p className="text-2xl font-bold tabular-nums">{money(r.total)}</p>
          {r.changePct !== null && <p className="text-xs text-muted">{r.changePct === 0 ? "About the same as" : `${Math.abs(r.changePct)}% ${r.changePct > 0 ? "more than" : "less than"}`} last month</p>}
        </div>
        <div className="card p-4">
          <p className="text-xs text-muted">Your share</p>
          <p className="text-2xl font-bold tabular-nums">{money(r.mine)}</p>
          <p className="text-xs text-muted">You paid {money(r.paidByMe)} up front</p>
        </div>
      </div>

      <Section title="Last 6 months">
        <figure className="card p-4">
          <div className="flex h-36 items-end gap-2" role="img" aria-label={`Household spending by month: ${r.trend.map((t) => `${t.label} ${money(t.total)}`).join(", ")}`}>
            {r.trend.map((t) => (
              <Link key={t.month} href={`/expenses/insights?month=${t.month}`} title={`${t.label}: ${money(t.total)} total, your share ${money(t.mine)}`}
                className="group flex h-full flex-1 flex-col justify-end">
                <div className={`rounded-t ${t.month === r.month ? "bg-brand-600" : "bg-brand-200 group-hover:bg-brand-300"}`} style={{ height: `${Math.max(t.total ? 3 : 0, (t.total / maxTrend) * 100)}%` }} />
              </Link>
            ))}
          </div>
          <div className="mt-1 flex gap-2 text-center text-xs text-muted" aria-hidden>
            {r.trend.map((t) => <span key={t.month} className={`flex-1 ${t.month === r.month ? "font-semibold text-ink" : ""}`}>{t.label}</span>)}
          </div>
          <figcaption className="mt-2 text-xs text-muted">Tap a month to see its breakdown.</figcaption>
        </figure>
      </Section>

      <Section title="By category">
        {r.categories.length === 0 ? (
          <EmptyState icon="🧾" title="No expenses this month" body="Add one from the Expenses page." />
        ) : (
          <ul className="card space-y-3 p-4">
            {r.categories.map((c) => (
              <li key={c.category}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium capitalize">{c.category}</span>
                  <span className="tabular-nums">{money(c.total)}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${(c.total / maxCat) * 100}%` }} />
                </div>
                <p className="mt-0.5 text-xs text-muted">{c.count} expense{c.count === 1 ? "" : "s"} · your share {money(c.mine)}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {r.biggest && (
        <Section title="Biggest expense">
          <Link href={`/expenses/${r.biggest.id}`} className="card flex items-center justify-between gap-3 p-4 text-sm">
            <span><span className="font-medium">{r.biggest.description}</span><span className="block text-xs text-muted">{r.biggest.date}</span></span>
            <span className="font-semibold tabular-nums">{money(r.biggest.amountCents)}</span>
          </Link>
        </Section>
      )}
    </>
  );
}
