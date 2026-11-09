"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { smartAddAction } from "@/app/actions/tasks";
import { parseQuickAdd } from "@/lib/quick-add";

type Props = { today: string; tz: string; currentUserId: string; members: { id: string; name: string }[] };

const EXAMPLES = ["trash every Tue", "paper towels", "clean bathroom sat @jordan", "$42 pizza"];

/**
 * One box for chores, shopping and costs. The line under it says exactly what will happen
 * before you press Add; the server parses the text again with the same rules.
 */
export function QuickAddTask({ today, tz, currentUserId, members }: Props) {
  const [state, action, pending] = useActionState(smartAddAction, null);
  const [text, setText] = useState("");
  const [mine, setMine] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => parseQuickAdd(text, { today, tz, currentUserId, members }), [text, today, tz, currentUserId, members]);

  useEffect(() => {
    if (state?.ok) { setText(""); input.current?.focus(); }
  }, [state]);

  const summary = preview?.kind === "task" && !preview.assigneeId && mine ? preview.summary.replace(/for anyone$/, "for you") : preview?.summary;
  const placeholder = useMemo(() => `Quick add, e.g. ${EXAMPLES[new Date(today).getUTCDate() % EXAMPLES.length]}`, [today]);

  return (
    <form action={action} className="card p-3">
      <div className="flex gap-2">
        <label htmlFor="qa" className="sr-only">Quick add a chore, shopping item or cost</label>
        <input ref={input} id="qa" name="text" required maxLength={160} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={placeholder} autoComplete="off" aria-describedby="qa-preview" className="input flex-1" />
        <button type="submit" disabled={pending || !preview} className="btn-primary disabled:opacity-60">{pending ? "Adding…" : preview?.kind === "expense" ? "Next" : "Add"}</button>
      </div>
      <p id="qa-preview" aria-live="polite" className="mt-2 min-h-5 text-xs text-muted">
        {state?.error ? <span className="text-red-700" role="alert">{state.error}</span>
          : text && summary ? summary
          : state?.ok ? <span className="text-emerald-700">✓ {state.message}</span>
          : "Chores, shopping items, or a cost like “$20 pizza”. Add a day, “every Tue”, or @name."}
      </p>
      {preview?.kind === "task" && !preview.assigneeId && (
        <label className="mt-1 flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" name="mine" checked={mine} onChange={(e) => setMine(e.target.checked)} className="accent-brand-600" /> Assign to me
        </label>
      )}
    </form>
  );
}
