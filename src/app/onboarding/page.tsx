import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { TimezoneSelect } from "@/components/timezone-input";
import { createHouseholdAction, joinHouseholdAction } from "@/app/actions/households";
import { requireUser } from "@/server/session";
import { listMyHouseholds } from "@/server/households";
import { COMMON_TIMEZONES } from "@/lib/time";

export const metadata = { title: "Get started" };

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const user = await requireUser();
  const households = await listMyHouseholds(user.id);
  const { code } = await searchParams;
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <p className="text-sm font-semibold text-brand-700">Hi {user.name.split(" ")[0]} 👋</p>
      <h1 className="mb-1 text-2xl font-bold">Let's set up your place</h1>
      <p className="mb-6 text-sm text-muted">Start a household for your apartment, house, or dorm, or join the one your roommate already made.</p>

      <div className="card mb-4 p-5">
        <h2 className="mb-3 font-semibold">Join with an invite code</h2>
        <ActionForm action={joinHouseholdAction} className="flex gap-2">
          <label htmlFor="code" className="sr-only">Invite code</label>
          <input id="code" name="code" defaultValue={code} placeholder="e.g. K7Q2M9XPRA" required className="input font-mono uppercase tracking-wider" />
          <SubmitButton pendingText="Joining…">Join</SubmitButton>
        </ActionForm>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-semibold">Create a new household</h2>
        <ActionForm action={createHouseholdAction} className="space-y-4">
          <div>
            <label className="label" htmlFor="name">Household name</label>
            <input id="name" name="name" required maxLength={80} placeholder="Maple St. Apartment 4B" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="timezone">Timezone</label>
            <TimezoneSelect name="timezone" defaultValue={user.timezone} options={COMMON_TIMEZONES} />
            <p className="mt-1 text-xs text-muted">Due dates and reminders use this timezone.</p>
          </div>
          <SubmitButton className="btn-primary w-full" pendingText="Creating…">Create household</SubmitButton>
        </ActionForm>
      </div>
      {households.length > 0 && (
        <p className="mt-6 text-center text-sm"><Link href="/home" className="font-semibold text-brand-700">← Back to {households[0].name}</Link></p>
      )}
    </main>
  );
}
