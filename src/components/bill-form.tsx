"use client";

import { useMemo, useState } from "react";
import { ActionForm, SubmitButton } from "./forms";
import { createBillAction, updateBillAction } from "@/app/actions/bills";

const CATEGORIES = ["rent", "utilities", "internet", "household supplies", "groceries", "other"];

function toCents(s: string): number | null {
  const t = s.trim().replace(/[$,]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
}
const fmt = (c: number) => (c < 0 ? "-" : "") + "$" + (Math.abs(c) / 100).toFixed(2);
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

export type BillInitial = {
  id: string; description: string; amount: string; payerId: string; category: string;
  splitMethod: "EQUAL" | "CUSTOM"; participants: { userId: string; amount?: string }[]; dayOfMonth: number; startMonth: string;
  splitWithEveryone?: boolean;
};

export function BillForm({ members, currentUserId, thisMonth, initial }: {
  members: { id: string; name: string }[]; currentUserId: string; thisMonth: string; initial?: BillInitial;
}) {
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [method, setMethod] = useState<"EQUAL" | "CUSTOM">(initial?.splitMethod ?? "EQUAL");
  const [included, setIncluded] = useState<string[]>(initial && !initial.splitWithEveryone ? initial.participants.map((p) => p.userId) : members.map((m) => m.id));
  const [custom, setCustom] = useState<Record<string, string>>(Object.fromEntries((initial?.participants ?? []).filter((p) => p.amount).map((p) => [p.userId, p.amount!])));
  const [day, setDay] = useState(initial?.dayOfMonth ?? 1);
  const [everyone, setEveryone] = useState(initial?.splitWithEveryone ?? false);
  const total = toCents(amount);

  const preview = useMemo(() => {
    if (total === null || included.length === 0) return null;
    if (method === "EQUAL") {
      const base = Math.floor(total / included.length);
      const rem = total - base * included.length;
      return { per: Object.fromEntries(included.map((id, i) => [id, base + (i < rem ? 1 : 0)])), remaining: 0 };
    }
    const sum = included.reduce((s, id) => s + (toCents(custom[id] ?? "") ?? 0), 0);
    return { per: null, remaining: total - sum };
  }, [total, included, method, custom]);

  return (
    <ActionForm action={initial ? updateBillAction : createBillAction} className="space-y-5">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div>
        <label className="label" htmlFor="description">Bill</label>
        <input id="description" name="description" required maxLength={140} placeholder="Rent" defaultValue={initial?.description} className="input" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="amount">Amount each month</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
            <input id="amount" name="amount" inputMode="decimal" required placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="input pl-7" />
          </div>
          {amount && total === null && <p className="mt-1 text-xs text-red-700">Use a number like 1200.00</p>}
        </div>
        <div>
          <label className="label" htmlFor="payerId">Who pays it</label>
          <select id="payerId" name="payerId" defaultValue={initial?.payerId ?? currentUserId} className="input">
            {members.map((m) => <option key={m.id} value={m.id}>{m.id === currentUserId ? `${m.name} (me)` : m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="dayOfMonth">Day of the month</label>
          <select id="dayOfMonth" name="dayOfMonth" value={day} onChange={(e) => setDay(Number(e.target.value))} className="input">
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{ordinal(d)}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="category">Category</label>
          <select id="category" name="category" defaultValue={initial?.category ?? "rent"} className="input capitalize">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label" htmlFor="startMonth">Starting</label>
          <input id="startMonth" name="startMonth" type="month" required defaultValue={initial?.startMonth ?? thisMonth} className="input" />
          <p className="mt-1 text-xs text-muted">Added to Expenses on the {ordinal(day)} of each month. If that day has already passed this month, this month is added right away.</p>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="label">Split</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="splitWithEveryone" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} className="mt-0.5 h-5 w-5 accent-brand-600" />
          <span>Split equally with everyone who lives here<span className="block text-xs text-muted">Roommates who join later are included from their first month. People who move out stop being charged.</span></span>
        </label>
        {everyone ? <><input type="hidden" name="splitMethod" value="EQUAL" />{members.map((m) => <input key={m.id} type="hidden" name="participants" value={m.id} />)}</> : <>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
          {(["EQUAL", "CUSTOM"] as const).map((m) => (
            <label key={m} className={`cursor-pointer rounded-lg py-1.5 text-center font-medium ${method === m ? "bg-white shadow-sm" : "text-slate-600"}`}>
              <input type="radio" name="splitMethod" value={m} checked={method === m} onChange={() => setMethod(m)} className="sr-only" />
              {m === "EQUAL" ? "Equally" : "Custom amounts"}
            </label>
          ))}
        </div>
        <ul className="space-y-2">
          {members.map((m) => {
            const on = included.includes(m.id);
            return (
              <li key={m.id} className="flex items-center gap-3">
                <label className="flex flex-1 items-center gap-2 text-sm">
                  <input type="checkbox" name="participants" value={m.id} checked={on} className="h-5 w-5 accent-brand-600"
                    onChange={(e) => setIncluded((prev) => (e.target.checked ? members.map((x) => x.id).filter((id) => id === m.id || prev.includes(id)) : prev.filter((id) => id !== m.id)))} />
                  {m.id === currentUserId ? `${m.name} (me)` : m.name}
                </label>
                {method === "CUSTOM" ? (
                  <input name={`amt_${m.id}`} inputMode="decimal" placeholder="0.00" disabled={!on} aria-label={`${m.name}'s share`}
                    value={custom[m.id] ?? ""} onChange={(e) => setCustom({ ...custom, [m.id]: e.target.value })} className="input w-28 py-2 text-right" />
                ) : (
                  <span className="w-28 text-right text-sm text-muted">{on && preview?.per ? fmt(preview.per[m.id]) : "—"}</span>
                )}
              </li>
            );
          })}
        </ul>
        {method === "CUSTOM" && preview && (
          <p className={`text-sm font-medium ${preview.remaining === 0 ? "text-emerald-700" : "text-amber-800"}`} aria-live="polite">
            {preview.remaining === 0 ? "✓ Splits match the total" : preview.remaining > 0 ? `${fmt(preview.remaining)} left to assign` : `${fmt(-preview.remaining)} over the total`}
          </p>
        )}
        </>}
      </fieldset>
      <SubmitButton className="btn-primary w-full">{initial ? "Save changes" : "Add recurring bill"}</SubmitButton>
    </ActionForm>
  );
}
