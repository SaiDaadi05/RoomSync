"use client";

import { useEffect, useState } from "react";

/** Opens the phone's share sheet (Messages, WhatsApp…). Hidden where the browser has no share sheet. */
export function ShareButton({ title, text, url, className = "btn-secondary min-h-9 px-3 text-xs" }: { title: string; text: string; url: string; className?: string }) {
  const [can, setCan] = useState(false);
  useEffect(() => setCan(typeof navigator !== "undefined" && typeof navigator.share === "function"), []);
  if (!can) return null;
  return (
    <button type="button" className={className}
      onClick={() => navigator.share({ title, text, url }).catch(() => { /* closed the sheet */ })}>
      Share
    </button>
  );
}
