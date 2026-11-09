"use client";

import { useEffect, useState } from "react";

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on" | "busy";

function urlBase64ToUint8Array(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Turn phone/browser notifications on or off for this device. */
export function PushToggle({ publicKey, devices }: { publicKey: string | null; devices: number }) {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(ios && !standalone ? "ios-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  if (!publicKey) return <p className="text-xs text-muted">Phone notifications aren&apos;t set up on this server yet (it needs VAPID keys).</p>;

  const turnOn = async () => {
    setError(null);
    setState("busy");
    try {
      if ((await Notification.requestPermission()) !== "granted") return setState("denied");
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const res = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) { await sub.unsubscribe(); throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't turn them on"); }
      setState("on");
    } catch (e) {
      setError((e as Error).message);
      setState("off");
    }
  };

  const turnOff = async () => {
    setState("busy");
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState("off");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <p className="text-sm font-medium">Notifications on this device</p>
          <p className="text-xs text-muted">
            {state === "on" ? "On. Reminders, nudges and swap requests show up even when RoomSync is closed."
              : state === "denied" ? "Blocked in your browser settings. Allow notifications for this site, then come back."
                : state === "ios-install" ? "On iPhone, add RoomSync to your Home Screen first (Share, then Add to Home Screen), then open it from there."
                  : state === "unsupported" ? "This browser doesn't support push notifications."
                    : "Get reminders on your phone even when RoomSync is closed."}
            {devices > 0 && state !== "on" ? ` On for ${devices} other device${devices === 1 ? "" : "s"}.` : ""}
          </p>
        </div>
        {(state === "off" || state === "busy") && <button type="button" onClick={turnOn} disabled={state === "busy"} className="btn-secondary min-h-9 text-sm disabled:opacity-60">Turn on</button>}
        {state === "on" && <button type="button" onClick={turnOff} className="btn-ghost min-h-9 text-sm">Turn off</button>}
      </div>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
