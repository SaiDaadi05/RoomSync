"use client";

import { ActionForm, SubmitButton } from "./forms";
import { assignAction, rescheduleAction, skipAction } from "@/app/actions/tasks";

export function OccurrenceActions({
  occurrenceId, assigneeId, members, dueDate, dueTime,
}: { occurrenceId: string; assigneeId: string | null; members: { id: string; name: string }[]; dueDate: string; dueTime: string }) {
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-xs font-semibold text-brand-700 marker:hidden">
        <span className="group-open:hidden">Change…</span><span className="hidden group-open:inline">Close</span>
      </summary>
      <div className="mt-3 space-y-3 rounded-xl bg-slate-50 p-3">
        <ActionForm action={assignAction} className="flex items-end gap-2">
          <input type="hidden" name="occurrenceId" value={occurrenceId} />
          <div className="flex-1">
            <label className="label text-xs" htmlFor={`a-${occurrenceId}`}>Assigned to</label>
            <select id={`a-${occurrenceId}`} name="assigneeId" defaultValue={assigneeId ?? ""} className="input py-2 text-sm">
              <option value="">Anyone</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <SubmitButton className="btn-secondary">Reassign</SubmitButton>
        </ActionForm>
        <ActionForm action={rescheduleAction} className="flex items-end gap-2">
          <input type="hidden" name="occurrenceId" value={occurrenceId} />
          <div className="flex-1">
            <label className="label text-xs" htmlFor={`d-${occurrenceId}`}>New due date</label>
            <input id={`d-${occurrenceId}`} type="date" name="date" defaultValue={dueDate} required className="input py-2 text-sm" />
          </div>
          <div className="w-28">
            <label className="label text-xs" htmlFor={`t-${occurrenceId}`}>Time</label>
            <input id={`t-${occurrenceId}`} type="time" name="time" defaultValue={dueTime} required className="input py-2 text-sm" />
          </div>
          <SubmitButton className="btn-secondary">Move</SubmitButton>
        </ActionForm>
        <ActionForm action={skipAction} className="flex items-end gap-2">
          <input type="hidden" name="occurrenceId" value={occurrenceId} />
          <div className="flex-1">
            <label className="label text-xs" htmlFor={`s-${occurrenceId}`}>Skip this one (reason optional)</label>
            <input id={`s-${occurrenceId}`} name="reason" maxLength={200} placeholder="Nobody home this week" className="input py-2 text-sm" />
          </div>
          <SubmitButton className="btn-secondary">Skip</SubmitButton>
        </ActionForm>
      </div>
    </details>
  );
}
