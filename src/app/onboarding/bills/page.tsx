import Link from "next/link";
import { requireHousehold } from "@/server/session";
import { addStarterBillsAction } from "@/app/actions/bills";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ONBOARDING_DONE, OnboardingSteps } from "@/components/onboarding-steps";
import { STARTER_BILLS } from "@/lib/starter-bills";

export const metadata = { title: "First bills" };

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

export default async function OnboardingBills() {
  await requireHousehold();
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <OnboardingSteps current={4} />
      <h1 className="mb-1 text-2xl font-bold">Add your monthly bills</h1>
      <p className="mb-6 text-sm text-muted">
        Fill in the ones you pay and leave the rest blank. Each month RoomSync adds them to Money, split equally with everyone who lives here, including roommates who join later.
      </p>
      <ActionForm action={addStarterBillsAction} className="space-y-3">
        {STARTER_BILLS.map((b) => (
          <fieldset key={b.key} className="card p-4">
            <legend className="sr-only">{b.label}</legend>
            <input type="hidden" name={`name_${b.key}`} value={b.label} />
            <p className="mb-2 font-semibold">{b.label}</p>
            <div className="grid grid-cols-[1fr_8rem] gap-2">
              <div>
                <label className="label text-xs font-medium text-muted" htmlFor={`amount_${b.key}`}>Amount each month</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                  <input id={`amount_${b.key}`} name={`amount_${b.key}`} inputMode="decimal" placeholder={b.placeholder} className="input pl-7" />
                </div>
              </div>
              <div>
                <label className="label text-xs font-medium text-muted" htmlFor={`day_${b.key}`}>Due on the</label>
                <select id={`day_${b.key}`} name={`day_${b.key}`} defaultValue={b.day} className="input">
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{ordinal(d)}</option>)}
                </select>
              </div>
            </div>
          </fieldset>
        ))}
        <p className="text-xs text-muted">You're set as the one who pays these. You can change who pays, the split, or pause a bill any time under Money.</p>
        <div className="flex gap-2 pt-2">
          <Link href={ONBOARDING_DONE} className="btn-secondary flex-1">Skip for now</Link>
          <SubmitButton className="btn-primary flex-1" pendingText="Saving…">Save and finish</SubmitButton>
        </div>
      </ActionForm>
    </main>
  );
}
