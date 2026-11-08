"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/server/action";

const PendingContext = createContext(false);

export function SubmitButton({ children, className = "btn-primary", pendingText }: { children: ReactNode; className?: string; pendingText?: string }) {
  const { pending: formPending } = useFormStatus();
  const ctxPending = useContext(PendingContext);
  const pending = formPending || ctxPending;
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? pendingText ?? "Saving…" : children}
    </button>
  );
}

/**
 * A form bound to a server action that returns ActionState; shows errors inline.
 * Submits via onSubmit so React doesn't clear the fields when validation fails
 * (React 19 resets uncontrolled inputs after a form action). Without JS, the plain
 * `action` attribute still works.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  id,
}: {
  id?: string;
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  // Only take over submission once hydrated; before that the native form action handles it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    startTransition(() => formAction(fd));
  };
  return (
    <PendingContext.Provider value={pending}>
      <form ref={ref} id={id} action={mounted ? undefined : formAction} onSubmit={mounted ? onSubmit : undefined} className={className}>
        {state?.error && (
          <p role="alert" className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>
        )}
        {state?.ok && state.message && (
          <p role="status" className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>
        )}
        {children}
      </form>
    </PendingContext.Provider>
  );
}
