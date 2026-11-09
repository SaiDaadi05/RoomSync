/** "Step 2 of 4" header shared by the first-run setup screens. */
export const ONBOARDING_STEPS = ["Your place", "Roommates", "Chores", "Bills"] as const;

export function OnboardingSteps({ current }: { current: number }) {
  const total = ONBOARDING_STEPS.length;
  return (
    <div className="mb-6">
      <p className="text-sm text-muted">
        Step {current} of {total} · <span className="font-semibold text-ink">{ONBOARDING_STEPS[current - 1]}</span>
      </p>
      <div className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }} aria-hidden>
        {ONBOARDING_STEPS.map((s, i) => (
          <span key={s} className={`h-1 rounded-full ${i < current ? "bg-ink" : "bg-slate-200"}`} />
        ))}
      </div>
    </div>
  );
}
