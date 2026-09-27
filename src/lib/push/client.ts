"use client";
/**
 * Browser/native push helpers. Inside the iOS app (Capacitor) we use APNs via the
 * PushNotifications plugin; everywhere else Web Push via the service worker.
 */

type Listener = { remove: () => Promise<void> };
interface CapPush {
  checkPermissions(): Promise<{ receive: "granted" | "denied" | "prompt" | "prompt-with-rationale" }>;
  requestPermissions(): Promise<{ receive: "granted" | "denied" | "prompt" | "prompt-with-rationale" }>;
  register(): Promise<void>;
  addListener(event: "registration", cb: (t: { value: string }) => void): Promise<Listener>;
  addListener(event: "registrationError", cb: (e: { error: string }) => void): Promise<Listener>;
  addListener(event: "pushNotificationActionPerformed", cb: (a: { notification: { data?: { link?: string } } }) => void): Promise<Listener>;
  removeAllDeliveredNotifications?(): Promise<void>;
}
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: { PushNotifications?: CapPush };
}

export function capacitor(): CapacitorGlobal | null {
  const c = (globalThis as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return c?.isNativePlatform?.() ? c : null;
}

export function nativePush(): CapPush | null {
  return capacitor()?.Plugins?.PushNotifications ?? null;
}

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on";

const TOKEN_KEY = "lil.apnsToken";

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function isIosSafariNotInstalled(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function api(method: "POST" | "DELETE", body: object) {
  const res = await fetch("/api/push/subscribe", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
  if (!res.ok) throw new Error(`push ${method} failed (${res.status})`);
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (capacitor()) return /iPad/.test(ua) ? "iPad app" : "iPhone app";
  if (/iPhone/.test(ua)) return "iPhone (home screen)";
  if (/iPad/.test(ua)) return "iPad (home screen)";
  if (/Android/.test(ua)) return "Android";
  return "Browser";
}

export async function currentPushState(): Promise<PushState> {
  const native = nativePush();
  if (native) {
    const p = await native.checkPermissions();
    if (p.receive === "denied") return "denied";
    return p.receive === "granted" && safeStorage()?.getItem(TOKEN_KEY) ? "on" : "off";
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return isIosSafariNotInstalled() ? "needs-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/** Must be called from a user gesture (tap). */
export async function enablePush(vapidPublicKey: string | null): Promise<PushState> {
  const native = nativePush();
  if (native) {
    const p = await native.requestPermissions();
    if (p.receive !== "granted") return "denied";
    await native.register(); // token arrives via the "registration" listener (NativePushBridge)
    return "on";
  }
  if (!vapidPublicKey) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource }));
  await api("POST", { kind: "WEB", subscription: sub.toJSON(), label: deviceLabel() });
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const native = nativePush();
  if (native) {
    const token = safeStorage()?.getItem(TOKEN_KEY);
    if (token) await api("DELETE", { token }).catch(() => undefined);
    safeStorage()?.removeItem(TOKEN_KEY);
    return "off";
  }
  const reg = await navigator.serviceWorker?.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api("DELETE", { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
  return "off";
}

/** On sign-out: stop this device receiving the signed-out person's alerts. */
export async function forgetThisDevice(): Promise<void> {
  try {
    await Promise.race([disablePush(), new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    /* never block sign-out */
  }
}

export async function saveNativeToken(token: string): Promise<void> {
  safeStorage()?.setItem(TOKEN_KEY, token);
  await api("POST", { kind: "APNS", token, label: deviceLabel() }).catch(() => undefined);
}
