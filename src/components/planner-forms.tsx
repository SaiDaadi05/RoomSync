"use client";

import { ActionForm, SubmitButton } from "./forms";
import { acceptProposalsAction, planManuallyAction, swapAction, syncToGoogleAction, addAvailabilityAction } from "@/app/actions/planner";

export type ProposalView = { occurrenceId: string; title: string; who: string; when: string; reason: string; ok: boolean; payload: string };

export function ProposalsForm({ proposals, cta }: { proposals: ProposalView[]; cta: string }) {
  const okCount = proposals.filter((p) => p.ok).length;
  return (
    <ActionForm action={acceptProposalsAction} className="space-y-2">
      <ul className="space-y-2">
        {proposals.map((p) => (
          <li key={p.occurrenceId} className={`card p-3 ${p.ok ? "" : "border-amber-200 bg-amber-50"}`}>
            <label className="flex items-start gap-3">
              {p.ok ? <input type="checkbox" name="proposal" value={p.payload} defaultChecked className="mt-1 h-5 w-5 accent-brand-600" /> : <span aria-hidden className="mt-0.5">⚠️</span>}
              <span className="flex-1">
                <span className="block font-medium">{p.title}</span>
                {p.ok && <span className="block text-sm"><b>{p.who}</b> · {p.when}</span>}
                <span className="block text-xs text-muted">{p.reason}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {okCount > 0 && <SubmitButton className="btn-primary w-full">{cta}</SubmitButton>}
      <p className="text-center text-xs text-muted">Nothing changes until you accept. Accepted times are saved in RoomSync only; add them to Google Calendar individually.</p>
    </ActionForm>
  );
}

export function PlanManually({ occurrenceId, date }: { occurrenceId: string; date: string }) {
  return (
    <details>
      <summary className="cursor-pointer text-xs font-semibold text-brand-700">Pick a time</summary>
      <ActionForm action={planManuallyAction} className="mt-2 flex items-end gap-2">
        <input type="hidden" name="occurrenceId" value={occurrenceId} />
        <input type="date" name="date" defaultValue={date} required className="input py-1.5 text-sm" aria-label="Date" />
        <input type="time" name="time" defaultValue="18:00" required className="input w-28 py-1.5 text-sm" aria-label="Start time" />
        <SubmitButton className="btn-secondary min-h-9 text-xs">Plan</SubmitButton>
      </ActionForm>
    </details>
  );
}

export function SyncGoogle({ occurrenceId }: { occurrenceId: string }) {
  return (
    <ActionForm action={syncToGoogleAction}>
      <input type="hidden" name="occurrenceId" value={occurrenceId} />
      <SubmitButton className="text-xs font-semibold text-brand-700" pendingText="Adding…">+ Google Calendar</SubmitButton>
    </ActionForm>
  );
}

export function SwapForm({ mine, theirs }: { mine: { id: string; label: string }[]; theirs: { id: string; label: string }[] }) {
  return (
    <ActionForm action={swapAction} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <select name="mine" required className="input text-sm" aria-label="Your task">
          {mine.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <select name="theirs" required className="input text-sm" aria-label="Their task">
          {theirs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      <SubmitButton className="btn-secondary w-full">Swap these</SubmitButton>
      <p className="text-xs text-muted">Talk to your roommate first. They get a notification and can swap back.</p>
    </ActionForm>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function AvailabilityForm() {
  return (
    <ActionForm action={addAvailabilityAction} className="space-y-3" resetOnSuccess>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
        {DAYS.map((d, i) => (
          <label key={d} className="cursor-pointer">
            <input type="checkbox" name="weekday" value={i + 1} className="peer sr-only" />
            <span className="chip border border-slate-300 bg-white px-3 py-1.5 text-sm peer-checked:border-brand-500 peer-checked:bg-brand-600 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500">{d}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input type="time" name="start" defaultValue="18:00" required className="input" aria-label="From" />
        <span className="text-muted">to</span>
        <input type="time" name="end" defaultValue="21:00" required className="input" aria-label="To" />
      </div>
      <SubmitButton className="btn-primary w-full">Add free time</SubmitButton>
    </ActionForm>
  );
}
