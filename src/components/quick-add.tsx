"use client";

import { ActionForm, SubmitButton } from "./forms";
import { quickAddTaskAction } from "@/app/actions/tasks";

export function QuickAddTask() {
  return (
    <ActionForm action={quickAddTaskAction} resetOnSuccess className="card p-3">
      <div className="flex gap-2">
        <label htmlFor="qa" className="sr-only">Quick add a task for today</label>
        <input id="qa" name="title" required maxLength={120} placeholder="Quick add: e.g. Unload groceries" className="input flex-1" />
        <SubmitButton pendingText="…">Add</SubmitButton>
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" name="mine" defaultChecked className="accent-brand-600" /> Assign to me · due tonight
      </label>
    </ActionForm>
  );
}
