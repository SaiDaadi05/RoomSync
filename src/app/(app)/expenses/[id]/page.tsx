import Link from "next/link";
import { notFound } from "next/navigation";
import { requireHousehold } from "@/server/session";
import { getExpense } from "@/server/expenses";
import { prisma } from "@/server/db";
import { formatCents } from "@/lib/money";
import { Avatar, Badge, Section } from "@/components/ui";
import { ReceiptUpload } from "@/components/receipt-upload";
import { deleteExpenseAction } from "@/app/actions/money";
import { AppError } from "@/server/errors";

export default async function ExpenseDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, household } = await requireHousehold();
  let e;
  try { e = await getExpense(user.id, id); } catch (err) { if (err instanceof AppError) notFound(); throw err; }
  const people = await prisma.user.findMany({ where: { id: { in: [e.payerId, ...e.splits.map((s) => s.userId)] } }, select: { id: true, name: true } });
  const nameOf = (uid: string) => people.find((p) => p.id === uid)?.name ?? "Someone";
  const cur = household.currency;
  return (
    <>
      <Link href="/expenses" className="mb-3 inline-block text-sm font-medium text-brand-700">← Expenses</Link>
      <div className="card mb-5 p-5">
        <p className="text-sm text-muted">{e.date} · <span className="capitalize">{e.category}</span></p>
        <h1 className="text-xl font-bold">{e.description}</h1>
        <p className="mt-2 text-3xl font-bold tabular-nums">{formatCents(e.amountCents, cur)}</p>
        <p className="mt-1 text-sm text-muted">Paid by <b className="text-ink">{nameOf(e.payerId)}</b> · split {e.splitMethod === "EQUAL" ? "equally" : "by custom amounts"}</p>
      </div>
      <Section title="Who owes what">
        <ul className="card divide-y divide-slate-100">
          {e.splits.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar id={s.userId} name={nameOf(s.userId)} size="sm" />
              <span className="flex-1">{nameOf(s.userId)}</span>
              <span className="tabular-nums">{formatCents(s.amountCents, cur)}</span>
              {s.userId === e.payerId && <Badge tone="green">paid</Badge>}
            </li>
          ))}
        </ul>
      </Section>
      {e.shoppingItems.length > 0 && (
        <Section title="Shopping items">
          <p className="card px-4 py-3 text-sm">{e.shoppingItems.map((i) => i.name).join(", ")}</p>
        </Section>
      )}
      <Section title="Receipt">
        <div className="card space-y-3 p-4">
          {e.receiptKey ? (
            <a href={`/api/receipts/${e.id}`} target="_blank" rel="noopener" className="btn-secondary">📎 View receipt</a>
          ) : (
            <p className="text-sm text-muted">No receipt attached.</p>
          )}
          <ReceiptUpload expenseId={e.id} replace={!!e.receiptKey} />
        </div>
      </Section>
      <form action={deleteExpenseAction} className="mt-6 text-center">
        <input type="hidden" name="id" value={e.id} />
        <button className="btn-danger">Delete expense</button>
        <p className="mt-1 text-xs text-muted">Removes it from balances. Linked shopping items stay marked as bought.</p>
      </form>
    </>
  );
}
