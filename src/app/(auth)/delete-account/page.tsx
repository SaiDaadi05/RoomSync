import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { deleteAccountAction } from "@/app/actions/auth";
import { requireUser } from "@/server/session";
import { accountDeletionBlockers } from "@/server/account";

export const metadata = { title: "Delete account" };

export default async function DeleteAccountPage() {
  const user = await requireUser();
  const households = await accountDeletionBlockers(user.id);
  return (
    <div className="card p-6">
      <h1 className="mb-1 text-xl font-bold">Delete your account</h1>
      {user.isDemo ? (
        <p className="text-sm text-muted">The demo account can't be deleted. It's cleaned up automatically.</p>
      ) : households.length > 0 ? (
        <>
          <p className="mb-4 text-sm text-muted">
            First move out of {households.join(", ")}. Moving out is where you settle up and hand off your chores, so your roommates aren't left guessing.
          </p>
          <Link href="/household#leave" className="btn-secondary w-full">Go to Household</Link>
        </>
      ) : (
        <>
          <div className="mb-5 space-y-2 text-sm text-muted">
            <p>This signs you out everywhere and removes your name, email, password, payment apps, calendars, devices and notifications. You can't undo it.</p>
            <p>Expenses and payments you shared stay in your old households' history so their balances still add up. They'll show you as “Former roommate”.</p>
          </div>
          <ActionForm action={deleteAccountAction} className="space-y-4">
            <div>
              <label className="label" htmlFor="password">Your password</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
            </div>
            <div>
              <label className="label" htmlFor="confirm">Type DELETE to confirm</label>
              <input id="confirm" name="confirm" required autoComplete="off" autoCapitalize="characters" className="input" />
            </div>
            <SubmitButton className="btn-secondary w-full border-red-300 text-red-700" pendingText="Deleting…">Delete my account</SubmitButton>
          </ActionForm>
        </>
      )}
      <p className="mt-5 text-center text-sm text-muted"><Link href="/home" className="font-semibold text-brand-700">Keep my account</Link></p>
    </div>
  );
}
