import { requireHousehold } from "@/server/session";
import { activeMembers } from "@/server/access";
import { ExpenseForm } from "@/components/expense-form";
import { PageHeader } from "@/components/ui";
import { todayIn } from "@/lib/time";

export const metadata = { title: "New expense" };

export default async function NewExpense() {
  const { user, household } = await requireHousehold();
  const members = await activeMembers(household.id);
  return (
    <>
      <PageHeader title="Add an expense" />
      <div className="card p-5"><ExpenseForm members={members} currentUserId={user.id} today={todayIn(household.timezone)} /></div>
    </>
  );
}
