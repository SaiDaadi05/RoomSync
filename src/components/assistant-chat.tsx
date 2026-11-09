"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { askAssistantAction, confirmDraftAction, discardDraftAction, type AskResult, type DraftView } from "@/app/actions/assistant";

type Draft = DraftView & { state: "pending" | "busy" | "done" | "discarded" | "error"; link?: string | null; error?: string };
type Entry = { role: "user" | "assistant"; text: string; drafts?: Draft[]; error?: boolean };

const EXAMPLES = [
  "I paid $60 for internet, split with everyone",
  "Add milk, eggs and dish soap to the list",
  "Who owes me money?",
  "What's left for me this week?",
];

export function AssistantChat({ initialDrafts, firstName }: { initialDrafts: DraftView[]; firstName: string }) {
  const [entries, setEntries] = useState<Entry[]>(
    initialDrafts.length ? [{ role: "assistant", text: "You have drafts waiting from earlier:", drafts: initialDrafts.map((d) => ({ ...d, state: "pending" })) }] : [],
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [entries]);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || busy) return;
    const history = entries.filter((e) => !e.error).map((e) => ({ role: e.role, text: e.text }));
    setEntries((es) => [...es, { role: "user", text: msg }]);
    setInput("");
    setBusy(true);
    const r: AskResult = await askAssistantAction(msg, history).catch(() => ({ error: "Couldn't reach the server. Check your connection." }));
    setBusy(false);
    setEntries((es) => [...es, r.error
      ? { role: "assistant", text: r.error, error: true }
      : { role: "assistant", text: r.reply ?? "", drafts: (r.drafts ?? []).map((d) => ({ ...d, state: "pending" as const })) }]);
  };

  const updateDraft = (id: string, patch: Partial<Draft>) =>
    setEntries((es) => es.map((e) => (e.drafts ? { ...e, drafts: e.drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)) } : e)));

  const confirm = async (id: string) => {
    updateDraft(id, { state: "busy", error: undefined });
    const r = await confirmDraftAction(id).catch(() => ({ error: "Couldn't reach the server." }));
    if ("error" in r && r.error) updateDraft(id, { state: "error", error: r.error });
    else updateDraft(id, { state: "done", link: "link" in r ? r.link : null });
  };
  const discard = async (id: string) => {
    updateDraft(id, { state: "busy" });
    await discardDraftAction(id).catch(() => null);
    updateDraft(id, { state: "discarded" });
  };

  const onSubmit = (e: FormEvent) => { e.preventDefault(); void send(input); };

  return (
    <div className="flex flex-col gap-4 pb-28">
      {entries.length === 0 && (
        <div className="card p-4">
          <p className="font-semibold">Hi {firstName}, what do you need?</p>
          <p className="mt-1 text-sm text-muted">Tell me about an expense, a shopping run, or a chore in plain words. I&apos;ll draft it, and nothing changes until you tap Confirm.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => void send(ex)} className="chip border border-slate-200 bg-white px-3 py-1.5 text-left text-sm hover:border-brand-300">{ex}</button>
            ))}
          </div>
        </div>
      )}

      <ol className="flex flex-col gap-3" aria-live="polite">
        {entries.map((e, i) => (
          <li key={i} className={e.role === "user" ? "self-end max-w-[85%]" : "self-start max-w-[92%] w-full"}>
            {e.text && (
              <p className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${e.role === "user" ? "bg-brand-600 text-white" : e.error ? "bg-red-50 text-red-800" : "bg-white shadow-sm ring-1 ring-slate-100"}`}>{e.text}</p>
            )}
            {e.drafts?.map((d) => (
              <div key={d.id} className={`mt-2 rounded-2xl border p-3 text-sm ${d.state === "done" ? "border-emerald-200 bg-emerald-50" : d.state === "discarded" ? "border-slate-200 bg-slate-50 text-muted" : "border-amber-200 bg-amber-50"}`} data-draft>
                <p className={`text-xs font-semibold uppercase tracking-wide ${d.state === "done" ? "text-emerald-800" : d.state === "discarded" ? "text-slate-500" : "text-amber-800"}`}>{d.state === "done" ? "Saved" : d.state === "discarded" ? "Discarded" : "Draft · not saved yet"}</p>
                <p className="mt-1 text-slate-800">{d.summary}</p>
                {d.error && <p role="alert" className="mt-2 text-red-700">{d.error}</p>}
                {(d.state === "pending" || d.state === "busy" || d.state === "error") && (
                  <div className="mt-2 flex gap-2">
                    <button type="button" disabled={d.state === "busy"} onClick={() => void confirm(d.id)} className="btn-primary min-h-9 flex-1 text-xs">{d.state === "busy" ? "Saving…" : "Confirm"}</button>
                    <button type="button" disabled={d.state === "busy"} onClick={() => void discard(d.id)} className="btn-secondary min-h-9 flex-1 text-xs">Discard</button>
                  </div>
                )}
                {d.state === "done" && d.link && <Link href={d.link} className="mt-2 inline-block text-xs font-semibold text-brand-700">View →</Link>}
              </div>
            ))}
          </li>
        ))}
        {busy && <li className="self-start rounded-2xl bg-white px-4 py-2.5 text-sm text-muted shadow-sm ring-1 ring-slate-100">Thinking…</li>}
      </ol>
      <div ref={endRef} />

      <form onSubmit={onSubmit} className="fixed inset-x-0 bottom-16 z-10 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:bottom-0">
        <div className="mx-auto flex max-w-3xl gap-2">
          <label htmlFor="assistant-input" className="sr-only">Message the assistant</label>
          <input id="assistant-input" value={input} onChange={(e) => setInput(e.target.value)} maxLength={2000} placeholder="e.g. I paid $45 for groceries" className="input flex-1" autoComplete="off" />
          <button type="submit" disabled={busy || !input.trim()} className="btn-primary">Send</button>
        </div>
      </form>
    </div>
  );
}
