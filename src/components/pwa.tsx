"use client";

import { useEffect, useState } from "react";

/** Registers the service worker in production builds only (dev HMR and SWs don't mix). */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
const DISMISS_KEY = "roomsync:install-dismissed";

function read(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private mode: just don't remember */ }
}

/**
 * "Add RoomSync to your home screen". Chrome/Edge/Android get the native prompt;
 * iPhone Safari has no prompt API, so it gets the Share → Add to Home Screen steps.
 * Hidden once installed or dismissed.
 */
export function InstallPrompt() {
  const [evt, setEvt] = useState<InstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone || read(DISMISS_KEY)) return;
    const ua = navigator.userAgent;
    const isIos = /iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    if (isIos) { setIos(true); setHidden(false); }
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as InstallPromptEvent); setHidden(false); };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (hidden) return null;
  const dismiss = () => { write(DISMISS_KEY, "1"); setHidden(true); };

  return (
    <div role="region" aria-label="Install RoomSync" className="card mb-4 flex items-start gap-3 p-4">
      <img src="/icons/icon-192.png" alt="" width={40} height={40} className="rounded-xl" />
      <div className="flex-1 text-sm">
        <p className="font-semibold">Add RoomSync to your home screen</p>
        {evt ? (
          <p className="text-muted">Opens full-screen like an app.</p>
        ) : ios ? (
          <p className="text-muted">In Safari, tap Share{" "}
            <svg aria-hidden viewBox="0 0 24 24" className="inline h-4 w-4 -translate-y-0.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>, then <span className="font-medium text-slate-700">Add to Home Screen</span>.</p>
        ) : null}
        <div className="mt-2 flex gap-2">
          {evt && (
            <button
              className="btn-primary min-h-9 text-xs"
              onClick={async () => { await evt.prompt(); const r = await evt.userChoice; if (r.outcome === "accepted") setHidden(true); setEvt(null); }}
            >Install</button>
          )}
          <button className="btn-ghost min-h-9 text-xs" onClick={dismiss}>Not now</button>
        </div>
      </div>
    </div>
  );
}
