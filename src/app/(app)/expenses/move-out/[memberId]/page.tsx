import Link from "next/link";
import { notFound } from "next/navigation";
import { requireHousehold } from "@/server/session";
import { moveOutPlan } from "@/server/moveout";
import { AppError } from "@/server/errors";
import { formatCents } from "@/lib/money";
import { PageHeader } from "@/components/ui";
import { MoveOutPayments, MoveOutSettleForm } from "@/components/settings-forms";

export const metadata = { title: "Move-out settle-up" };

export default async function MoveOutPage({ params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  const { user, household } = await requireHousehold();
  let plan;
  try { plan = await moveOutPlan(user.id, household.id, memberId); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const cur = household.currency;
  return (
    <>
      <Link href="/expenses" className="mb-3 inline-block text-sm font-medium text-brand-700">← Expenses</Link>
      <PageHeader title={`Settle up with ${plan.name}`} subtitle={plan.active ? "Still in the household" : "Moved out"} />
      <div className="card space-y-4 p-5">
        {plan.cents === 0 ? (
          <p className="font-semibold">{plan.name} is all settled up.</p>
        ) : (
          <>
            <p className="font-semibold">{plan.name} {plan.cents < 0 ? `owes ${formatCents(-plan.cents, cur)}` : `is owed ${formatCents(plan.cents, cur)}`}.</p>
            <MoveOutPayments plan={{ userId: plan.userId, cents: plan.cents, currency: cur, payments: plan.payments }} viewerId={user.id} />
            <p className="text-xs text-muted">Once these have been paid outside the app, record them so everyone's balance is right. Only an owner or {plan.name} can do this.</p>
            <MoveOutSettleForm memberId={plan.userId} label="Record these as paid" />
          </>
        )}
      </div>
    </>
  );
}
