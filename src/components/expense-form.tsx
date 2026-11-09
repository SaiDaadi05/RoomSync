"use client";

import { useMemo, useState } from "react";
import { ActionForm, SubmitButton } from "./forms";
import { createExpenseAction } from "@/app/actions/money";
import type { ActionState } from "@/server/action";
import { allocateByWeights, itemizedSplit, parsePercent } from "@/lib/split";

const CATEGORIES = ["groceries", "household supplies", "rent", "utilities", "internet", "food & dining", "furniture", "other"];

export type SplitMethod = "EQUAL" | "CUSTOM" | "SHARES" | "PERCENT" | "ITEMIZED";
const METHODS: { id: SplitMethod; label: string; hint: string }[] = [
  { id: "EQUAL", label: "Equally", hint: "Everyone ticked pays the same." },
  { id: "SHARES", label: "Shares", hint: "e.g. 2 for the person with the big room, 1 for everyone else." },
  { id: "PERCENT", label: "Percent", hint: "Percents must add up to 100." },
  { id: "CUSTOM", label: "Amounts", hint: "Type exactly what each person owes." },
  { id: "ITEMIZED", label: "By item", hint: "Say who shared each item. Tax, tip and fees are shared in proportion." },
];

function toCents(s: string): number | null {
  const t = s.trim().replace(/[$,]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
}
const fmt = (c: number) => (c < 0 ? "-" : "") + "$" + (Math.abs(c) / 100).toFixed(2);

type Item = { name: string; amount: string; who: string[] };

export type ExpenseInitial = {
  id: string; description: string; amount: string; date: string; payerId: string; category: string;
  splitMethod: SplitMethod; participants: string[]; custom: Record<string, string>;
  weights?: Record<string, string>; items?: Item[];
};

type Preview = { per: Record<string, number>; note?: string; error?: string };

export function ExpenseForm({ members, currentUserId, today, initial, prefill, action = createExpenseAction, submitLabel = "Save expense" }: {
  members: { id: string; name: string }[]; currentUserId: string; today: string;
  initial?: ExpenseInitial; prefill?: { amount?: string; description?: string }; action?: (s: ActionState, fd: FormData) => Promise<ActionState>; submitLabel?: string;
}) {
  const everyone = members.map((m) => m.id);
  const [amount, setAmount] = useState(initial?.amount ?? prefill?.amount ?? "");
  const [method, setMethod] = useState<SplitMethod>(initial?.splitMethod ?? "EQUAL");
  const [included, setIncluded] = useState<string[]>(initial?.participants.length ? initial.participants : everyone);
  const [custom, setCustom] = useState<Record<string, string>>(initial?.custom ?? {});
  const [shares, setShares] = useState<Record<string, string>>(initial?.splitMethod === "SHARES" ? initial.weights ?? {} : {});
  const [pcts, setPcts] = useState<Record<string, string>>(initial?.splitMethod === "PERCENT" ? initial.weights ?? {} : {});
  const [items, setItems] = useState<Item[]>(initial?.items?.length ? initial.items : [{ name: "", amount: "", who: everyone }]);
  const total = toCents(amount);
  const nameOf = (id: string) => (id === currentUserId ? "Me" : members.find((m) => m.id === id)?.name.split(" ")[0] ?? "?");

  const preview = useMemo((): Preview | null => {
    if (total === null || total <= 0) return null;
    if (method === "ITEMIZED") {
      const parsed = items.filter((i) => i.name.trim() || i.amount.trim()).map((i) => ({ name: i.name, amountCents: toCents(i.amount) ?? -1, userIds: i.who }));
      if (!parsed.length) return { per: {}, error: "Add at least one item" };
      if (parsed.some((i) => i.amountCents <= 0)) return { per: {}, error: "Each item needs an amount like 4.50" };
      if (parsed.some((i) => !i.userIds.length)) return { per: {}, error: "Pick who shares each item" };
      const sum = parsed.reduce((s, i) => s + i.amountCents, 0);
      if (sum > total) return { per: {}, error: `Items add up to ${fmt(sum)}, more than the ${fmt(total)} total` };
      const per = Object.fromEntries(itemizedSplit(total, parsed));
      return { per, note: sum < total ? `${fmt(total - sum)} of tax, tip or fees shared in proportion` : "✓ Items match the total" };
    }
    if (!included.length) return { per: {}, error: "Pick at least one person" };
    if (method === "EQUAL") {
      const parts = allocateByWeights(total, included.map(() => 1));
      return { per: Object.fromEntries(included.map((id, i) => [id, parts[i]])) };
    }
    if (method === "CUSTOM") {
      const sum = included.reduce((s, id) => s + (toCents(custom[id] ?? "") ?? 0), 0);
      const left = total - sum;
      return { per: {}, note: left === 0 ? "✓ Splits match the total" : undefined, error: left === 0 ? undefined : left > 0 ? `${fmt(left)} left to assign` : `${fmt(-left)} over the total` };
    }
    const raw = method === "SHARES" ? shares : pcts;
    const weights = included.map((id) => (method === "SHARES" ? (/^\d{1,6}$/.test((raw[id] ?? "1").trim() || "0") ? Number((raw[id] ?? "1").trim() || "0") : null) : parsePercent((raw[id] ?? "").trim() || "0")));
    if (weights.some((w) => w === null)) return { per: {}, error: method === "SHARES" ? "Shares must be whole numbers" : "Percents must be numbers like 25 or 12.5" };
    const ws = weights as number[];
    const sum = ws.reduce((s, w) => s + w, 0);
    if (method === "PERCENT" && sum !== 10_000) return { per: {}, error: `Percents add up to ${Number((sum / 100).toFixed(2))}%, not 100%` };
    if (sum === 0) return { per: {}, error: "Give at least one person a share" };
    const parts = allocateByWeights(total, ws);
    return { per: Object.fromEntries(included.map((id, i) => [id, parts[i]])), note: method === "PERCENT" ? "✓ Adds up to 100%" : undefined };
  }, [total, method, included, custom, shares, pcts, items]);

  const toggle = (id: string, on: boolean) =>
    setIncluded((prev) => (on ? everyone.filter((x) => x === id || prev.includes(x)) : prev.filter((x) => x !== id)));
  const setItem = (i: number, patch: Partial<Item>) => setItems((prev) => prev.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const hint = METHODS.find((m) => m.id === method)!.hint;

  return (
    <ActionForm action={action} className="space-y-5">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div>
        <label className="label" htmlFor="description">What was it for?</label>
        <input id="description" name="description" required maxLength={140} placeholder="Costco run" defaultValue={initial?.description ?? prefill?.description} className="input" />
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
          <input id="date" name="date" type="date" defaultValue={initial?.date ?? today} required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="payerId">Paid by</label>
          <select id="payerId" name="payerId" defaultValue={initial?.payerId ?? currentUserId} className="input">
            {members.map((m) => <option key={m.id} value={m.id}>{m.id === currentUserId ? `${m.name} (me)` : m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="category">Category</label>
          <select id="category" name="category" defaultValue={initial?.category ?? "groceries"} className="input capitalize">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="label">Split</legend>
        <div className="grid grid-cols-5 gap-1 rounded-xl bg-slate-100 p-1 text-xs sm:text-sm" role="radiogroup" aria-label="How to split">
          {METHODS.map((m) => (
            <label key={m.id} className={`cursor-pointer rounded-lg px-1 py-1.5 text-center font-medium ${method === m.id ? "bg-white shadow-sm" : "text-slate-600"}`}>
              <input type="radio" name="splitMethod" value={m.id} checked={method === m.id} onChange={() => setMethod(m.id)} className="sr-only" />
              {m.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">{hint}</p>

        {method === "ITEMIZED" ? (
          <div className="space-y-3">
            <input type="hidden" name="itemCount" value={items.length} />
            {items.map((it, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-3">
                <div className="flex gap-2">
                  <input name={`item_name_${i}`} placeholder={i === 0 ? "e.g. Wine" : "Item"} aria-label={`Item ${i + 1} name`} maxLength={80}
                    value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} className="input flex-1 py-2" />
                  <input name={`item_amt_${i}`} inputMode="decimal" placeholder="0.00" aria-label={`Item ${i + 1} amount`}
                    value={it.amount} onChange={(e) => setItem(i, { amount: e.target.value })} className="input w-24 py-2 text-right" />
                  {items.length > 1 && (
                    <button type="button" onClick={() => setItems((prev) => prev.filter((_, k) => k !== i))} aria-label={`Remove item ${i + 1}`} className="btn-ghost min-h-9 px-2 text-slate-500">✕</button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`Who shares item ${i + 1}`}>
                  {members.map((m) => {
                    const on = it.who.includes(m.id);
                    return (
                      <label key={m.id} className={`chip cursor-pointer border py-1 text-xs ${on ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500"}`}>
                        <input type="checkbox" name={`item_who_${i}`} value={m.id} checked={on} className="sr-only"
                          onChange={(e) => setItem(i, { who: e.target.checked ? everyone.filter((x) => x === m.id || it.who.includes(x)) : it.who.filter((x) => x !== m.id) })} />
                        {nameOf(m.id)}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setItems((prev) => [...prev, { name: "", amount: "", who: everyone }])} className="btn-secondary w-full min-h-9 text-sm">+ Add item</button>
            {preview && Object.keys(preview.per).length > 0 && (
              <ul className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
                {Object.entries(preview.per).map(([id, c]) => (
                  <li key={id} className="flex justify-between"><span>{nameOf(id)}</span><span className="tabular-nums">{fmt(c)}</span></li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {members.map((m) => {
              const on = included.includes(m.id);
              return (
                <li key={m.id} className="flex items-center gap-3">
                  <label className="flex flex-1 items-center gap-2 text-sm">
                    <input type="checkbox" name="participants" value={m.id} checked={on} className="h-5 w-5 accent-brand-600" onChange={(e) => toggle(m.id, e.target.checked)} />
                    {m.id === currentUserId ? `${m.name} (me)` : m.name}
                  </label>
                  {method === "CUSTOM" && (
                    <input name={`amt_${m.id}`} inputMode="decimal" placeholder="0.00" disabled={!on} aria-label={`${m.name}'s share`}
                      value={custom[m.id] ?? ""} onChange={(e) => setCustom({ ...custom, [m.id]: e.target.value })} className="input w-24 py-2 text-right" />
                  )}
                  {method === "SHARES" && (
                    <input name={`w_${m.id}`} inputMode="numeric" placeholder="1" disabled={!on} aria-label={`${m.name}'s shares`}
                      value={shares[m.id] ?? "1"} onChange={(e) => setShares({ ...shares, [m.id]: e.target.value })} className="input w-14 py-2 text-right" />
                  )}
                  {method === "PERCENT" && (
                    <div className="relative">
                      <input name={`pct_${m.id}`} inputMode="decimal" placeholder="0" disabled={!on} aria-label={`${m.name}'s percent`}
                        value={pcts[m.id] ?? ""} onChange={(e) => setPcts({ ...pcts, [m.id]: e.target.value })} className="input w-20 py-2 pr-6 text-right" />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-slate-500">%</span>
                    </div>
                  )}
                  {method !== "CUSTOM" && (
                    <span className="w-20 text-right text-sm tabular-nums text-muted">{on && preview?.per[m.id] !== undefined ? fmt(preview.per[m.id]) : "—"}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {preview && (preview.error || preview.note) && (
          <p className={`text-sm font-medium ${preview.error ? "text-amber-800" : "text-emerald-700"}`} aria-live="polite">{preview.error ?? preview.note}</p>
        )}
      </fieldset>

      {!initial && <div>
        <label className="label" htmlFor="receipt">Receipt (optional)</label>
        <input id="receipt" name="receipt" type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-semibold file:text-brand-700" />
        <p className="mt-1 text-xs text-muted">JPG, PNG, WEBP, HEIC or PDF up to 5 MB. Only your household can see it.</p>
      </div>}
      <SubmitButton className="btn-primary w-full">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
