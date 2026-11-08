"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "./forms";
import { shoppingBulkAction } from "@/app/actions/money";

export function ShoppingBulk({ members, today, currentUserId }: { members: { id: string; name: string }[]; today: string; currentUserId: string }) {
  const [mode, setMode] = useState<"expense" | "bought" | "errand">("expense");
  return (
    <ActionForm id="bulk" action={shoppingBulkAction} className="card space-y-3 p-4" resetOnSuccess>
      <p className="text-sm font-semibold">With the ticked items…</p>
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 text-sm" role="radiogroup" aria-label="Action">
        {([["expense", "Bought + split"], ["bought", "Just bought"], ["errand", "Plan a run"]] as const).map(([k, label]) => (
          <label key={k} className={`cursor-pointer rounded-lg px-2 py-1.5 text-center font-medium ${mode === k ? "bg-white shadow-sm" : "text-slate-600"}`}>
            <input type="radio" name="mode" value={k} checked={mode === k} onChange={() => setMode(k)} className="sr-only" />
            {label}
          </label>
        ))}
      </div>
      {mode === "expense" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label text-xs" htmlFor="b-amount">Total paid</label>
              <input id="b-amount" name="amount" inputMode="decimal" placeholder="0.00" required className="input" />
            </div>
            <div>
              <label className="label text-xs" htmlFor="b-date">Date</label>
              <input id="b-date" name="date" type="date" defaultValue={today} required className="input" />
            </div>
          </div>
          <input name="description" placeholder="Description (optional)" maxLength={140} className="input" aria-label="Description" />
          <fieldset>
            <legend className="label text-xs">Split equally between</legend>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => (
                <label key={m.id} className="chip cursor-pointer border border-slate-300 bg-white py-1.5 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
                  <input type="checkbox" name="participants" value={m.id} defaultChecked className="accent-brand-600" /> {m.id === currentUserId ? "Me" : m.name}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-muted">You'll be recorded as the payer. Items are marked bought and linked to the expense.</p>
        </>
      )}
      {mode === "bought" && <p className="text-xs text-muted">Marks items as bought without recording a shared expense (e.g. you're keeping them, or you'll add the cost later).</p>}
      {mode === "errand" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label text-xs" htmlFor="e-date">When</label>
            <input id="e-date" name="date" type="date" defaultValue={today} className="input" />
          </div>
          <div>
            <label className="label text-xs" htmlFor="e-who">Who's going</label>
            <select id="e-who" name="assigneeId" defaultValue={currentUserId} className="input">
              <option value="">Anyone</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </div>
      )}
      <SubmitButton className="btn-primary w-full">{mode === "expense" ? "Mark bought & add expense" : mode === "bought" ? "Mark bought" : "Create shopping run"}</SubmitButton>
    </ActionForm>
  );
}
