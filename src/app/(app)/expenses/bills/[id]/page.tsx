import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { requireHousehold } from "@/server/session";
import { activeMembers } from "@/server/access";
import { getBill } from "@/server/bills";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { formatCents } from "@/lib/money";
import { BillForm } from "@/components/bill-form";
import { PageHeader, Section } from "@/components/ui";
import { deleteBillAction, pauseBillAction } from "@/app/actions/bills";

export const metadata = { title: "Recurring bill" };

const cents = (c: number) => (c / 100).toFixed(2);

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, household } = await requireHousehold();
  const { id } = await params;
  const bill = await getBill(user.id, id).catch((e) => { if (e instanceof AppError) notFound(); throw e; });
  if (bill.householdId !== household.id) notFound();
  const [members, history, membership] = await Promise.all([
    activeMembers(household.id),
    prisma.expense.findMany({ where: { recurringBillId: bill.id }, orderBy: { period: "desc" }, take: 12, select: { id: true, period: true, amountCents: true, deletedAt: true } }),
    prisma.membership.findUniqueOrThrow({ where: { householdId_userId: { householdId: household.id, userId: user.id } } }),
  ]);
  const canEdit = bill.createdById === user.id || membership.role === "OWNER";
  const participants = bill.participants as { userId: string; amountCents?: number }[];

  return (
    <>
      <PageHeader title={bill.description} subtitle={`${formatCents(bill.amountCents)} every month${bill.pausedAt ? " · paused" : ""}`} />
      {bill.lastError && <p role="alert" className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{bill.lastError}</p>}

      {canEdit ? (
        <div className="card mb-4 p-5">
          <BillForm
            members={members} currentUserId={user.id} thisMonth={DateTime.now().setZone(household.timezone).toFormat("yyyy-LL")}
            initial={{
              id: bill.id, description: bill.description, amount: cents(bill.amountCents), payerId: bill.payerId, category: bill.category,
              splitMethod: bill.splitMethod === "CUSTOM" ? "CUSTOM" : "EQUAL", dayOfMonth: bill.dayOfMonth, startMonth: bill.startMonth,
              participants: participants.map((p) => ({ userId: p.userId, amount: p.amountCents !== undefined ? cents(p.amountCents) : undefined })),
            }}
          />
        </div>
      ) : (
        <p className="card mb-4 p-4 text-sm text-muted">Only the person who set up this bill or an owner can change it.</p>
      )}

      <Section title="Months added">
        {history.length === 0 ? <p className="text-sm text-muted">Nothing added yet.</p> : (
          <ul className="card divide-y divide-slate-100">
            {history.map((e) => (
              <li key={e.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>{DateTime.fromFormat(e.period!, "yyyy-LL").toFormat("LLLL yyyy")}</span>
                {e.deletedAt ? <span className="text-muted">Skipped (deleted)</span> : <Link href={`/expenses/${e.id}`} className="font-medium text-brand-700">{formatCents(e.amountCents)} →</Link>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">To skip one month, delete that month&apos;s expense. It won&apos;t be added again.</p>
      </Section>

      {canEdit && (
        <div className="space-y-3">
          <form action={pauseBillAction}>
            <input type="hidden" name="id" value={bill.id} />
            <input type="hidden" name="paused" value={bill.pausedAt ? "0" : "1"} />
            <button className="btn-secondary w-full">{bill.pausedAt ? "Resume this bill" : "Pause this bill"}</button>
          </form>
          <details className="card p-4">
            <summary className="cursor-pointer list-none text-center text-sm font-semibold text-red-700">Delete this bill…</summary>
            <form action={deleteBillAction} className="mt-3 space-y-2">
              <input type="hidden" name="id" value={bill.id} />
              <p className="text-sm text-slate-700">Future months stop. Months already added stay in Expenses and balances.</p>
              <button className="btn-danger w-full">Yes, delete the bill</button>
            </form>
          </details>
        </div>
      )}
    </>
  );
}
