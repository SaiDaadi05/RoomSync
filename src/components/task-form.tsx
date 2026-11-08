"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "./forms";
import type { ActionState } from "@/server/action";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CATEGORIES = ["cleaning", "kitchen", "trash", "laundry", "bathroom", "groceries", "errands", "bills", "other"];

export type TaskFormValues = {
  id?: string;
  title: string;
  description: string;
  kind: "CHORE" | "ERRAND";
  category: string;
  estimatedMinutes: number;
  recurrence: "NONE" | "DAILY" | "WEEKLY";
  interval: number;
  weekdays: number[];
  startsOn: string;
  endsOn: string;
  dueTime: string;
  assignmentMode: "UNASSIGNED" | "FIXED" | "ROTATE";
  assigneeId: string;
  eligibleUserIds: string[];
};

export function TaskForm({
  action, initial, members, submitLabel,
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  initial: TaskFormValues;
  members: { id: string; name: string }[];
  submitLabel: string;
}) {
  const [recurrence, setRecurrence] = useState(initial.recurrence);
  const [mode, setMode] = useState(initial.assignmentMode);
  const [kind, setKind] = useState(initial.kind);
  return (
    <ActionForm action={action} className="space-y-5">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Type">
        {(["CHORE", "ERRAND"] as const).map((k) => (
          <label key={k} className={`btn border ${kind === k ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 bg-white"}`}>
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
            {k === "CHORE" ? "🧽 Chore" : "🏃 Errand"}
          </label>
        ))}
      </div>
      <div>
        <label className="label" htmlFor="title">What needs doing?</label>
        <input id="title" name="title" required maxLength={120} defaultValue={initial.title} className="input" placeholder={kind === "CHORE" ? "Clean the bathroom" : "Pick up a package"} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="category">Category</label>
          <select id="category" name="category" defaultValue={initial.category} className="input capitalize">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="estimatedMinutes">Takes about (min)</label>
          <input id="estimatedMinutes" name="estimatedMinutes" type="number" min={1} max={1440} defaultValue={initial.estimatedMinutes} className="input" />
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="label">Repeats</legend>
        <div className="grid grid-cols-3 gap-2">
          {(["NONE", "DAILY", "WEEKLY"] as const).map((r) => (
            <label key={r} className={`btn border ${recurrence === r ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 bg-white"}`}>
              <input type="radio" name="recurrence" value={r} checked={recurrence === r} onChange={() => setRecurrence(r)} className="sr-only" />
              {r === "NONE" ? "Once" : r === "DAILY" ? "Daily" : "Weekly"}
            </label>
          ))}
        </div>
        {recurrence !== "NONE" && (
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="interval">Every</label>
            <input id="interval" name="interval" type="number" min={1} max={52} defaultValue={initial.interval} className="input w-20" />
            <span>{recurrence === "DAILY" ? "day(s)" : "week(s)"}</span>
          </div>
        )}
        {recurrence === "WEEKLY" && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days of the week">
            {WEEKDAYS.map((d, i) => (
              <label key={d} className="cursor-pointer">
                <input type="checkbox" name="weekdays" value={i + 1} defaultChecked={initial.weekdays.includes(i + 1)} className="peer sr-only" />
                <span className="chip border border-slate-300 bg-white px-3 py-1.5 text-sm peer-checked:border-brand-500 peer-checked:bg-brand-600 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500">{d}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="startsOn">{recurrence === "NONE" ? "Due date" : "Starting"}</label>
          <input id="startsOn" name="startsOn" type="date" required defaultValue={initial.startsOn} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="dueTime">Due by</label>
          <input id="dueTime" name="dueTime" type="time" required defaultValue={initial.dueTime} className="input" />
        </div>
        {recurrence !== "NONE" && (
          <div className="col-span-2">
            <label className="label" htmlFor="endsOn">Until (optional)</label>
            <input id="endsOn" name="endsOn" type="date" defaultValue={initial.endsOn} className="input" />
          </div>
        )}
      </div>

      <fieldset className="space-y-3">
        <legend className="label">Who's responsible?</legend>
        <select name="assignmentMode" value={mode} onChange={(e) => setMode(e.target.value as TaskFormValues["assignmentMode"])} className="input" aria-label="Assignment">
          <option value="UNASSIGNED">Anyone can pick it up</option>
          <option value="FIXED">One roommate</option>
          {recurrence !== "NONE" && members.length > 1 && <option value="ROTATE">Take turns (rotate)</option>}
        </select>
        {mode === "FIXED" && (
          <select name="assigneeId" defaultValue={initial.assigneeId || members[0]?.id} className="input" aria-label="Assigned roommate">
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        {mode === "ROTATE" && (
          <div className="space-y-1">
            <p className="text-xs text-muted">Rotates in this order, one turn per occurrence:</p>
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="eligibleUserIds" value={m.id}
                  defaultChecked={initial.eligibleUserIds.length ? initial.eligibleUserIds.includes(m.id) : true} className="h-4 w-4 accent-brand-600" />
                {m.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div>
        <label className="label" htmlFor="description">Notes (optional)</label>
        <textarea id="description" name="description" rows={2} maxLength={2000} defaultValue={initial.description} className="input" placeholder="Where the supplies are, what counts as done…" />
      </div>
      <SubmitButton className="btn-primary w-full">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
