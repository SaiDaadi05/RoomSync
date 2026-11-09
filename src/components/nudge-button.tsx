"use client";

import { useActionState } from "react";
import { nudgeAction } from "@/app/actions/tasks";

export function NudgeButton({ occurrenceId, name }: { occurrenceId: string; name: string }) {
  const [state, action, pending] = useActionState(nudgeAction, null);
  if (state?.ok) return <span className="text-xs text-emerald-700" role="status">✓ {state.message}</span>;
  return (
    <form action={action} className="flex flex-col items-end">
      <input type="hidden" name="occurrenceId" value={occurrenceId} />
      <button disabled={pending} aria-label={`Nudge ${name} about this`}
        className="btn-secondary min-h-9 whitespace-nowrap px-3 text-xs disabled:opacity-60">
        {pending ? "Nudging…" : "👋 Nudge"}
      </button>
      {state?.error && <span className="mt-1 text-xs text-red-700" role="alert">{state.error}</span>}
    </form>
  );
}
