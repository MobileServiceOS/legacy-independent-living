/**
 * Push delivery: fan a notification out to every active device of a user
 * (Web Push browsers + iOS app via APNs). Dead devices are disabled automatically.
 */
import type { PushSubscription } from "@prisma/client";
import { prisma } from "../db";
import { sendApns, type ApnsConfig, type ApnsTransport } from "./apns";
import { sendWebPush, type VapidKeys } from "./webpush";

export function vapidConfig(): VapidKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT || "mailto:office@legacyindependentliving.net" };
}

export function apnsConfig(): ApnsConfig | null {
  const { APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_PRIVATE_KEY } = process.env;
  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_BUNDLE_ID || !APNS_PRIVATE_KEY) return null;
  return { keyId: APNS_KEY_ID, teamId: APNS_TEAM_ID, bundleId: APNS_BUNDLE_ID, privateKey: APNS_PRIVATE_KEY, production: process.env.APNS_ENV === "production" };
}

export function pushConfigured(): boolean {
  return Boolean(vapidConfig() || apnsConfig());
}

export interface PushMessage {
  title: string;
  body: string;
  link?: string | null;
  tag?: string;
}

/** Test seams. */
export const pushTransports: { fetchImpl?: typeof fetch; apns?: ApnsTransport } = {};

const MAX_FAILURES = 5;

async function markResult(sub: PushSubscription, ok: boolean, gone: boolean) {
  if (ok) {
    await prisma.pushSubscription.update({ where: { id: sub.id }, data: { failures: 0, lastSuccessAt: new Date() } });
  } else {
    const failures = sub.failures + 1;
    await prisma.pushSubscription.update({
      where: { id: sub.id },
      data: { failures, disabledAt: gone || failures >= MAX_FAILURES ? new Date() : null },
    });
  }
}

/** Returns how many devices accepted the push. */
export async function sendPushToUser(userId: string, msg: PushMessage): Promise<{ sent: number; failed: number; devices: number }> {
  const subs = await prisma.pushSubscription.findMany({ where: { userId, disabledAt: null } });
  if (!subs.length) return { sent: 0, failed: 0, devices: 0 };
  const badge = await prisma.notification.count({ where: { userId, readAt: null } });
  const web = vapidConfig();
  const apns = apnsConfig();
  let sent = 0;
  let failed = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        let result: { ok: boolean; gone?: boolean };
        if (sub.kind === "WEB") {
          if (!web || !sub.endpoint || !sub.p256dh || !sub.auth) return;
          result = await sendWebPush(
            { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
            { title: msg.title, body: msg.body, url: msg.link ?? "/", tag: msg.tag, badge },
            web,
            { fetchImpl: pushTransports.fetchImpl, urgency: "high", topic: msg.tag },
          );
        } else {
          if (!apns || !sub.apnsToken) return;
          result = await sendApns(sub.apnsToken, { title: msg.title, body: msg.body, link: msg.link, badge, threadId: msg.tag }, apns, pushTransports.apns);
        }
        await markResult(sub, result.ok, Boolean(!result.ok && "gone" in result && result.gone));
        if (result.ok) sent++;
        else failed++;
      } catch (err) {
        console.error("[push] send failed", sub.id, err);
        await markResult(sub, false, false);
        failed++;
      }
    }),
  );
  return { sent, failed, devices: subs.length };
}

// ------------------------------------------------------------------ device registry

export type RegisterInput =
  | { kind: "WEB"; endpoint: string; p256dh: string; auth: string; label?: string | null }
  | { kind: "APNS"; token: string; label?: string | null };

/** Idempotent: re-registering the same device moves it to the current user and re-enables it. */
export async function registerDevice(userId: string, input: RegisterInput): Promise<PushSubscription> {
  if (input.kind === "WEB") {
    return prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { userId, kind: "WEB", endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth, label: input.label ?? null },
      update: { userId, p256dh: input.p256dh, auth: input.auth, label: input.label ?? null, disabledAt: null, failures: 0 },
    });
  }
  const token = input.token.toLowerCase();
  return prisma.pushSubscription.upsert({
    where: { apnsToken: token },
    create: { userId, kind: "APNS", apnsToken: token, label: input.label ?? null },
    update: { userId, label: input.label ?? null, disabledAt: null, failures: 0 },
  });
}

export async function unregisterDevice(userId: string, ref: { endpoint?: string; token?: string }): Promise<number> {
  const where = ref.endpoint ? { endpoint: ref.endpoint, userId } : ref.token ? { apnsToken: ref.token.toLowerCase(), userId } : null;
  if (!where) return 0;
  const r = await prisma.pushSubscription.updateMany({ where, data: { disabledAt: new Date() } });
  return r.count;
}

export async function activeDeviceCount(userId: string): Promise<number> {
  return prisma.pushSubscription.count({ where: { userId, disabledAt: null } });
}

/** Signing out of a device stops its pushes (another person may use it next). */
export async function disableAllDevicesFor(userId: string): Promise<void> {
  await prisma.pushSubscription.updateMany({ where: { userId, disabledAt: null }, data: { disabledAt: new Date() } });
}
