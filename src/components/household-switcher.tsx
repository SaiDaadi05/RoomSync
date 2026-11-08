"use client";

import { switchHouseholdAction } from "@/app/actions/households";

export function HouseholdSwitcher({ current, households }: { current: string; households: { id: string; name: string }[] }) {
  return (
    <form action={switchHouseholdAction} className="min-w-0">
      <label htmlFor="hh" className="sr-only">Switch household</label>
      <select id="hh" name="householdId" defaultValue={current} onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="max-w-[12rem] truncate rounded-lg border-0 bg-transparent py-1 pr-7 font-semibold text-ink focus:ring-2 focus:ring-brand-200">
        {households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
      </select>
      <noscript><button className="ml-1 text-xs text-brand-700 underline">Go</button></noscript>
    </form>
  );
}
