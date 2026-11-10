import { requireHousehold } from "@/server/session";
import { addStarterChoresAction } from "@/app/actions/households";
import { STARTER_CHORES } from "@/lib/starter-chores";
import { describeRule } from "@/lib/recurrence";
import { SubmitButton } from "@/components/forms";
import Link from "next/link";
import { OnboardingSteps } from "@/components/onboarding-steps";

export const metadata = { title: "First chores" };

export default async function FirstTasks() {
  const { household } = await requireHousehold();
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <OnboardingSteps current={3} />
      <h1 className="mb-1 text-2xl font-bold">Add your first chores</h1>
      <p className="mb-6 text-sm text-muted">Pick the usual suspects. You can change schedules and assign roommates once they join.</p>
      <form action={addStarterChoresAction} className="space-y-2">
        {STARTER_CHORES.map((c) => (
          <label key={c.key} className="card flex cursor-pointer items-center gap-3 p-4 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
            <input type="checkbox" name="chore" value={c.key} defaultChecked={["trash", "bathroom"].includes(c.key)} className="h-5 w-5 accent-brand-600" />
            <span className="flex-1">
              <span className="block font-medium">{c.title}</span>
              <span className="text-xs text-muted">{describeRule({ recurrence: c.recurrence, interval: 1, weekdays: [...c.weekdays] })} · ~{c.minutes} min</span>
            </span>
          </label>
        ))}
        <div className="flex gap-2 pt-4">
          <Link href="/onboarding/bills" className="btn-secondary flex-1">Skip for now</Link>
          <SubmitButton className="btn-primary flex-1" pendingText="Adding…">Add selected</SubmitButton>
        </div>
      </form>
    </main>
  );
}
