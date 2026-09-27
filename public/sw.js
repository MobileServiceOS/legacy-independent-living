/* Legacy Independent Living service worker.
 * Strategy:
 *  - Static assets (/_next/static, /icons, /brand, fonts): cache-first (immutable, hashed).
 *  - Page navigations: network-first; if offline, show the cached offline page.
 *  - Never cache API calls, server actions (POST), receipts or any authenticated HTML,
 *    so financial data is never served stale from cache.
 */
const VERSION = "lil-v2";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png", "/brand/logo-mark.webp"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isStatic(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/icons/") ||
      url.pathname.startsWith("/brand/") ||
      url.pathname.endsWith(".woff2"))
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (isStatic(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
  }
});

// ---------------------------------------------------------------- push notifications
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Legacy Living", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Legacy Living";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/favicon-64.png",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/" },
  };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      typeof data.badge === "number" && self.navigator && "setAppBadge" in self.navigator
        ? self.navigator.setAppBadge(data.badge).catch(() => undefined)
        : Promise.resolve(),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(self.location.origin) && "focus" in w) {
          w.navigate(url).catch(() => undefined);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

// Browser rotated the subscription: re-register it with the server.
self.addEventListener("pushsubscriptionchange", (event) => {
  const sub = event.newSubscription;
  if (!sub) return;
  event.waitUntil(
    fetch("/api/push/subscribe", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "WEB", subscription: sub.toJSON() }),
    }).catch(() => undefined),
  );
});
