"use client";

import { ActionForm, SubmitButton } from "./forms";
import { settleAction } from "@/app/actions/money";

export function SettleForm({ members, from, to, amount, today }: { members: { id: string; name: string }[]; from?: string; to?: string; amount?: string; today: string }) {
  return (
    <ActionForm action={settleAction} className="space-y-3" resetOnSuccess>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label text-xs" htmlFor="s-from">Who paid</label>
          <select id="s-from" name="fromUserId" defaultValue={from} className="input">{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        </div>
        <div>
          <label className="label text-xs" htmlFor="s-to">Paid to</label>
          <select id="s-to" name="toUserId" defaultValue={to ?? members[1]?.id} className="input">{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        </div>
        <div>
          <label className="label text-xs" htmlFor="s-amt">Amount</label>
          <input id="s-amt" name="amount" inputMode="decimal" defaultValue={amount} required placeholder="0.00" className="input" />
        </div>
        <div>
          <label className="label text-xs" htmlFor="s-date">Date</label>
          <input id="s-date" name="date" type="date" defaultValue={today} required className="input" />
        </div>
      </div>
      <input name="note" maxLength={200} placeholder="Note, e.g. Venmo" className="input" aria-label="Note" />
      <SubmitButton className="btn-primary w-full">Record payment</SubmitButton>
      <p className="text-center text-xs text-muted">This only records a payment you made outside RoomSync (cash, Venmo, Zelle…). No money moves through the app.</p>
    </ActionForm>
  );
}
