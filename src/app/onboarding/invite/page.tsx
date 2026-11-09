import Link from "next/link";
import { requireHousehold } from "@/server/session";
import { getHouseholdOverview, listInvitations } from "@/server/households";
import { createOnboardingInviteAction } from "@/app/actions/households";
import { ActionForm, SubmitButton } from "@/components/forms";
import { CopyButton } from "@/components/copy-button";
import { ShareButton } from "@/components/share-button";
import { OnboardingSteps } from "@/components/onboarding-steps";

export const metadata = { title: "Invite roommates" };

export default async function OnboardingInvite() {
  const { user, household } = await requireHousehold();
  const [{ members }, invites] = await Promise.all([
    getHouseholdOverview(user.id, household.id),
    listInvitations(user.id, household.id),
  ]);
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const others = members.filter((m) => m.id !== user.id);

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <OnboardingSteps current={2} />
      <h1 className="mb-1 text-2xl font-bold">Invite your roommates</h1>
      <p className="mb-6 text-sm text-muted">Chores, costs and the shopping list are shared with everyone who joins {household.name}. Each link works once and lasts 7 days.</p>

      {others.length > 0 && (
        <p className="mb-4 text-sm"><b>Already here:</b> {others.map((m) => m.name).join(", ")}</p>
      )}

      <div className="card mb-4 p-5">
        <ActionForm action={createOnboardingInviteAction} className="space-y-3">
          <div>
            <label className="label" htmlFor="email">Roommate's email <span className="font-normal text-muted">(optional)</span></label>
            <input id="email" name="email" type="email" placeholder="sam@example.com" className="input" />
            <p className="mt-1 text-xs text-muted">Adding an email means only that person can use the link. RoomSync doesn't send it for you; share it however you like.</p>
          </div>
          <SubmitButton className="btn-primary w-full" pendingText="Creating…">Create an invite link</SubmitButton>
        </ActionForm>
      </div>

      {invites.length > 0 && (
        <ul className="mb-4 space-y-2" aria-label="Open invites">
          {invites.map((inv) => {
            const link = `${appUrl}/join/${inv.code}`;
            return (
              <li key={inv.id} className="card p-4">
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-lg tracking-widest">{inv.code}</code>
                  <CopyButton text={link} label="Copy link" />
                  <ShareButton title={`Join ${household.name} on RoomSync`} text={`Join our place on RoomSync so we can split chores and costs:`} url={link} />
                </div>
                <p className="mt-1 truncate text-xs text-muted">{inv.email ? `For ${inv.email} · ` : ""}{link}</p>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex gap-2 pt-2">
        <Link href="/onboarding/first-tasks" className="btn-secondary flex-1">{invites.length || others.length ? "Back to it later" : "Skip for now"}</Link>
        <Link href="/onboarding/first-tasks" className="btn-primary flex-1">Next: chores</Link>
      </div>
    </main>
  );
}
