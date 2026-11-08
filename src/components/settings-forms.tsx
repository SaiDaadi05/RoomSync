"use client";

import { ActionForm, SubmitButton } from "./forms";
import { TimezoneSelect } from "./timezone-input";
import { updatePreferencesAction } from "@/app/actions/auth";
import { createInviteAction, leaveHouseholdAction, updateHouseholdAction } from "@/app/actions/households";

export function PreferencesForm({ user, timezones, emailAvailable }: {
  user: { name: string; timezone: string; preferredStart: string; preferredEnd: string; notifyInApp: boolean; notifyEmail: boolean };
  timezones: string[];
  emailAvailable: boolean;
}) {
  return (
    <ActionForm action={updatePreferencesAction} className="space-y-4">
      <div>
        <label className="label" htmlFor="p-name">Name</label>
        <input id="p-name" name="name" defaultValue={user.name} required maxLength={60} className="input" />
      </div>
      <div>
        <label className="label" htmlFor="timezone">Your timezone</label>
        <TimezoneSelect name="timezone" defaultValue={user.timezone} options={timezones} />
      </div>
      <fieldset>
        <legend className="label">Preferred hours for chores</legend>
        <div className="flex items-center gap-2">
          <input aria-label="From" type="time" name="preferredStart" defaultValue={user.preferredStart} className="input" />
          <span className="text-muted">to</span>
          <input aria-label="To" type="time" name="preferredEnd" defaultValue={user.preferredEnd} className="input" />
        </div>
        <p className="mt-1 text-xs text-muted">The planner only suggests times inside this window.</p>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="label">Reminders</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="notifyInApp" defaultChecked={user.notifyInApp} className="h-4 w-4 accent-brand-600" /> In-app notifications (the bell)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="notifyEmail" defaultChecked={user.notifyEmail} className="h-4 w-4 accent-brand-600" /> Email reminders</label>
        {!emailAvailable && <p className="text-xs text-amber-800">Email isn't configured on this server yet, so only in-app reminders are delivered.</p>}
      </fieldset>
      <SubmitButton>Save preferences</SubmitButton>
    </ActionForm>
  );
}

export function HouseholdForm({ name, timezone, timezones, canEdit }: { name: string; timezone: string; timezones: string[]; canEdit: boolean }) {
  return (
    <ActionForm action={updateHouseholdAction} className="space-y-4">
      <fieldset disabled={!canEdit} className="space-y-4">
        <div>
          <label className="label" htmlFor="h-name">Household name</label>
          <input id="h-name" name="name" defaultValue={name} required maxLength={80} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="timezone">Household timezone</label>
          <TimezoneSelect name="timezone" defaultValue={timezone} options={timezones} />
          <p className="mt-1 text-xs text-muted">Chore due times are in this timezone.</p>
        </div>
        {canEdit ? <SubmitButton className="btn-secondary">Save</SubmitButton> : <p className="text-xs text-muted">Only the owner can change these.</p>}
      </fieldset>
    </ActionForm>
  );
}

export function InviteForm() {
  return (
    <ActionForm action={createInviteAction} className="flex gap-2" resetOnSuccess>
      <label htmlFor="inv-email" className="sr-only">Email (optional)</label>
      <input id="inv-email" name="email" type="email" placeholder="Roommate's email (optional)" className="input flex-1" />
      <SubmitButton pendingText="…">Create invite</SubmitButton>
    </ActionForm>
  );
}

export function LeaveForm({ openTasks = 0 }: { openTasks?: number }) {
  return (
    <details className="card p-4">
      <summary className="cursor-pointer list-none text-center text-sm font-semibold text-red-700">Leave this household…</summary>
      <ActionForm action={leaveHouseholdAction} className="mt-3 space-y-3">
        <p className="text-sm text-slate-700">
          {openTasks > 0 ? `Your ${openTasks} open ${openTasks === 1 ? "task" : "tasks"} will become unassigned and your roommates will be told. ` : ""}
          Your completed chores, expenses, and balances stay in the household history. You can rejoin later with a new invite.
        </p>
        <SubmitButton className="btn-danger w-full" pendingText="Leaving…">Yes, leave</SubmitButton>
      </ActionForm>
    </details>
  );
}
