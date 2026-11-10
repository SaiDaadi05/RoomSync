import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { TimezoneSelect } from "@/components/timezone-input";
import { createHouseholdAction, joinHouseholdAction } from "@/app/actions/households";
import { requireUser } from "@/server/session";
import { listMyHouseholds } from "@/server/households";
import { prisma } from "@/server/db";
import { COMMON_TIMEZONES } from "@/lib/time";
import { OnboardingSteps } from "@/components/onboarding-steps";

export const metadata = { title: "Get started" };

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const user = await requireUser();
  const households = await listMyHouseholds(user.id);
  const { code } = await searchParams;
  // Someone removed from their only household lands here, where the notifications page
  // isn't reachable, so show the removal notice directly.
  const removals = await prisma.notification.findMany({
    where: { userId: user.id, type: "member_removed", createdAt: { gte: new Date(Date.now() - 14 * 86400_000) } },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      {households.length === 0 && <OnboardingSteps current={1} />}
      <h1 className="mb-1 text-2xl font-bold">Let's set up your place, {user.name.split(" ")[0]}</h1>
      {removals.map((n) => (
        <p key={n.id} role="status" className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{n.title}. {n.body}</p>
      ))}
      <p className="mb-6 text-sm text-muted">Start a household for your apartment, house, or dorm, or join the one your roommate already made.</p>

      <div className="card mb-4 p-5">
        <h2 className="mb-3 font-semibold">Join your roommate’s household</h2>
        <ActionForm action={joinHouseholdAction} className="flex gap-2">
          <label htmlFor="code" className="sr-only">Invite code</label>
          <input id="code" name="code" defaultValue={code} placeholder="e.g. K7Q2M9XPRA" maxLength={10} autoCapitalize="characters" autoCorrect="off" spellCheck={false} required className="input font-mono uppercase tracking-wider" />
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
      {households.length === 0 && !user.isDemo && (
        <p className="mt-8 text-center text-xs"><Link href="/delete-account" className="text-muted underline">Delete my account</Link></p>
      )}
    </main>
  );
}
