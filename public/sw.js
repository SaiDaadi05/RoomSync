// RoomSync service worker.
// Privacy rule: household pages and API responses are NEVER cached, because phones get
// shared and a cached page could show someone else's chores or balances. Only the
// offline page, icons, and Next's content-hashed static assets are cached.
const VERSION = "v2";
const SHELL = `roomsync-shell-${VERSION}`;
const STATIC = `roomsync-static-${VERSION}`;
const SHELL_FILES = ["/offline.html", "/icons/icon-192.png", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Page loads: always go to the network; show the offline page only if that fails.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
    return;
  }

  // Content-hashed build assets never change, so cache-first is safe.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(STATIC).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
  }
  // Everything else (API, receipts, RSC payloads) goes straight to the network.
});

// ---- Push notifications (reminders, nudges, swaps) ----
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "RoomSync", body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "RoomSync", {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag,
    data: { link: data.link || "/notifications" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = new URL(event.notification.data?.link || "/notifications", self.location.origin);
  if (link.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => new URL(w.url).origin === link.origin);
      if (open) return open.navigate(link.href).then((w) => (w || open).focus());
      return self.clients.openWindow(link.href);
    }),
  );
});
