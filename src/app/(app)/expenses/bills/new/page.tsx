import { DateTime } from "luxon";
import { requireHousehold } from "@/server/session";
import { activeMembers } from "@/server/access";
import { BillForm } from "@/components/bill-form";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "New recurring bill" };

export default async function NewBill() {
  const { user, household } = await requireHousehold();
  const members = await activeMembers(household.id);
  return (
    <>
      <PageHeader title="Add a recurring bill" subtitle="Rent, internet, utilities: added to Expenses every month, already split." />
      <div className="card p-5">
        <BillForm members={members} currentUserId={user.id} thisMonth={DateTime.now().setZone(household.timezone).toFormat("yyyy-LL")} />
      </div>
    </>
  );
}
