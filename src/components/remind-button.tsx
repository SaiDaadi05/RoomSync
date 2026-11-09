"use client";

import { useActionState } from "react";
import { remindToSettleAction } from "@/app/actions/money";

export function RemindButton({ debtorId, name }: { debtorId: string; name: string }) {
  const [state, action, pending] = useActionState(remindToSettleAction, null);
  if (state?.ok) return <span className="text-xs font-medium text-emerald-700" role="status">✓ {state.message}</span>;
  return (
    <form action={action} className="flex flex-col items-end">
      <input type="hidden" name="debtorId" value={debtorId} />
      <button disabled={pending} aria-label={`Remind ${name} to settle up`} className="btn-ghost min-h-9 text-xs disabled:opacity-60">
        {pending ? "Sending…" : "Remind"}
      </button>
      {state?.error && <span className="text-xs text-red-700" role="alert">{state.error}</span>}
    </form>
  );
}
