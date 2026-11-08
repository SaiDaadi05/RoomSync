"use client";

import { useMemo, useState } from "react";
import { ActionForm, SubmitButton } from "./forms";
import { createExpenseAction } from "@/app/actions/money";

const CATEGORIES = ["groceries", "household supplies", "rent", "utilities", "internet", "food & dining", "furniture", "other"];

function toCents(s: string): number | null {
  const t = s.trim().replace(/[$,]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
}
const fmt = (c: number) => (c < 0 ? "-" : "") + "$" + (Math.abs(c) / 100).toFixed(2);

export function ExpenseForm({ members, currentUserId, today }: { members: { id: string; name: string }[]; currentUserId: string; today: string }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"EQUAL" | "CUSTOM">("EQUAL");
  const [included, setIncluded] = useState<string[]>(members.map((m) => m.id));
  const [custom, setCustom] = useState<Record<string, string>>({});
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
    <ActionForm action={createExpenseAction} className="space-y-5">
      <div>
        <label className="label" htmlFor="description">What was it for?</label>
        <input id="description" name="description" required maxLength={140} placeholder="Costco run" className="input" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="amount">Total</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
            <input id="amount" name="amount" inputMode="decimal" required placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="input pl-7" />
          </div>
          {amount && total === null && <p className="mt-1 text-xs text-red-700">Use a number like 12.34</p>}
        </div>
        <div>
          <label className="label" htmlFor="date">Date</label>
          <input id="date" name="date" type="date" defaultValue={today} required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="payerId">Paid by</label>
          <select id="payerId" name="payerId" defaultValue={currentUserId} className="input">
            {members.map((m) => <option key={m.id} value={m.id}>{m.id === currentUserId ? `${m.name} (me)` : m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="category">Category</label>
          <select id="category" name="category" defaultValue="groceries" className="input capitalize">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="label">Split</legend>
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
      </fieldset>

      <div>
        <label className="label" htmlFor="receipt">Receipt (optional)</label>
        <input id="receipt" name="receipt" type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-semibold file:text-brand-700" />
        <p className="mt-1 text-xs text-muted">JPG, PNG, WEBP, HEIC or PDF up to 5 MB. Only your household can see it.</p>
      </div>
      <SubmitButton className="btn-primary w-full">Save expense</SubmitButton>
    </ActionForm>
  );
}
