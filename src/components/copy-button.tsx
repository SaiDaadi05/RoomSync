"use client";

import { useId, useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const [fallback, setFallback] = useState(false);
  const id = useId();
  return (
    <span className="inline-flex max-w-full flex-col gap-1">
      <button type="button" className="btn-secondary min-h-9 px-3 text-xs"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setFallback(false);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          } catch { setFallback(true); }
        }}>
        {done ? "Copied!" : label}
      </button>
      {fallback && (
        <span className="space-y-1">
          <label htmlFor={id} className="block text-xs text-muted">Select and copy manually</label>
          <input id={id} value={text} readOnly className="input text-xs" onFocus={(e) => e.currentTarget.select()} autoFocus />
        </span>
      )}
      <span className="sr-only" role="status">{done ? "Copied to clipboard" : fallback ? "Clipboard unavailable. Select and copy the text manually." : ""}</span>
    </span>
  );
}
