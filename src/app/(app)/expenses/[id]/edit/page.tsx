import Link from "next/link";
import { notFound } from "next/navigation";
import { requireHousehold } from "@/server/session";
import { getExpense } from "@/server/expenses";
import { activeMembers } from "@/server/access";
import { ExpenseForm } from "@/components/expense-form";
import { PageHeader } from "@/components/ui";
import { updateExpenseAction } from "@/app/actions/money";
import { AppError } from "@/server/errors";
import { todayIn } from "@/lib/time";

export const metadata = { title: "Edit expense" };

const dollars = (c: number) => (c / 100).toFixed(2);

export default async function EditExpense({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, household } = await requireHousehold();
  let e;
  try { e = await getExpense(user.id, id); } catch (err) { if (err instanceof AppError) notFound(); throw err; }
  const members = await activeMembers(e.householdId);
  return (
    <>
      <Link href={`/expenses/${e.id}`} className="mb-3 inline-block text-sm font-medium text-brand-700">← Back</Link>
      <PageHeader title="Edit expense" subtitle="Balances update as soon as you save. Everyone sees that it was edited." />
      <div className="card p-5">
        <ExpenseForm
          members={members}
          currentUserId={user.id}
          today={todayIn(household.timezone)}
          action={updateExpenseAction}
          submitLabel="Save changes"
          initial={{
            id: e.id, description: e.description, amount: dollars(e.amountCents), date: e.date, payerId: e.payerId,
            category: e.category, splitMethod: e.splitMethod, participants: e.splits.map((s) => s.userId),
            custom: Object.fromEntries(e.splits.map((s) => [s.userId, dollars(s.amountCents)])),
          }}
        />
      </div>
    </>
  );
}
