import { requireHousehold } from "@/server/session";
import { activeMembers } from "@/server/access";
import { ExpenseForm } from "@/components/expense-form";
import { PageHeader } from "@/components/ui";
import { todayIn } from "@/lib/time";

export const metadata = { title: "New expense" };

export default async function NewExpense({ searchParams }: { searchParams: Promise<{ amount?: string; description?: string }> }) {
  const sp = await searchParams;
  const amount = /^\d+(\.\d{1,2})?$/.test(sp.amount ?? "") ? sp.amount : undefined;
  const prefill = amount || sp.description ? { amount, description: sp.description?.slice(0, 140) } : undefined;
  const { user, household } = await requireHousehold();
  const members = await activeMembers(household.id);
  return (
    <>
      <PageHeader title="Add an expense" />
      <div className="card p-5"><ExpenseForm members={members} currentUserId={user.id} today={todayIn(household.timezone)} prefill={prefill} /></div>
    </>
  );
}
