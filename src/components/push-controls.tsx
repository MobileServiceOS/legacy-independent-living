"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { capacitor, currentPushState, disablePush, enablePush, forgetThisDevice, nativePush, saveNativeToken, type PushState } from "@/lib/push/client";
import { Icon } from "./icons";

const COPY: Record<PushState, string> = {
  on: "Notifications are on for this device.",
  off: "Get an alert when rent is due, a payment goes through, or a repair is scheduled.",
  denied: "Notifications are blocked. Turn them on in your device Settings for this app, then come back.",
  "needs-install": "On iPhone and iPad: tap Share, then “Add to Home Screen”, open Legacy Living from your home screen, and turn notifications on there.",
  unsupported: "This browser can't show notifications.",
};

/** Full on/off control (Profile, Notifications pages). */
export function PushSettings({ vapidKey }: { vapidKey: string | null }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    currentPushState().then(setState).catch(() => setState("unsupported"));
  }, []);
  if (state === null) return null;
  const configured = Boolean(vapidKey) || Boolean(capacitor());
  return (
    <div className="card p-5" data-testid="push-settings">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-ok-bg text-forest">
          <Icon name="bell" className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold">Push notifications</p>
          <p className="text-muted">{configured ? COPY[state] : "Push notifications aren't set up on this server yet."}</p>
          {error ? <p className="mt-1 text-sm font-semibold text-bad">{error}</p> : null}
        </div>
      </div>
      {configured && (state === "on" || state === "off") ? (
        <button
          type="button"
          disabled={busy}
          className={`${state === "on" ? "btn-secondary" : "btn-primary"} mt-4 w-full`}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setState(state === "on" ? await disablePush() : await enablePush(vapidKey));
            } catch {
              setError("Couldn't change notifications. Please try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Working…" : state === "on" ? "Turn off on this device" : "Turn on notifications"}
        </button>
      ) : null}
    </div>
  );
}

/** Gentle one-time prompt card for the home screen. */
export function PushPrompt({ vapidKey }: { vapidKey: string | null }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!vapidKey && !capacitor()) return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem("lil.pushPromptDismissed") === "1";
    } catch {
      /* private mode */
    }
    if (dismissed) return;
    currentPushState().then((s) => setShow(s === "off")).catch(() => undefined);
  }, [vapidKey]);
  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem("lil.pushPromptDismissed", "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  };
  return (
    <div className="card flex flex-col gap-3 p-5" role="region" aria-label="Turn on notifications">
      <p className="flex items-center gap-2 text-lg font-bold">
        <Icon name="bell" className="size-6 text-forest" /> Never miss a due date
      </p>
      <p className="text-muted">Turn on notifications to hear when rent is due, when your payment goes through, and when a repair is scheduled.</p>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary flex-1"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await enablePush(vapidKey);
            } finally {
              setBusy(false);
              dismiss();
            }
          }}
        >
          Turn on
        </button>
        <button type="button" className="btn-secondary" onClick={dismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}

/** Sign-out button that first detaches this device from push. */
export function SignOutButton({ action, className, label = "Sign out" }: { action: (fd: FormData) => Promise<void>; className?: string; label?: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const done = useRef(false);
  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={async (e) => {
        if (done.current) return;
        e.preventDefault();
        await forgetThisDevice();
        done.current = true;
        formRef.current?.requestSubmit();
      }}
    >
      <button type="submit" className={className}>
        {label}
      </button>
    </form>
  );
}

/**
 * Inside the iOS app: keep the APNs token registered and open the right screen
 * when a notification is tapped. Renders nothing; no-op in browsers.
 */
export function NativePushBridge() {
  const router = useRouter();
  useEffect(() => {
    const push = nativePush();
    if (!push) return;
    const listeners: Array<Promise<{ remove: () => Promise<void> }>> = [
      push.addListener("registration", (t) => void saveNativeToken(t.value)),
      push.addListener("registrationError", (e) => console.warn("APNs registration failed", e.error)),
      push.addListener("pushNotificationActionPerformed", (a) => {
        const link = a.notification.data?.link;
        if (link && link.startsWith("/")) router.push(link);
      }),
    ];
    // Refresh the token on every launch once permission exists (tokens can rotate).
    push.checkPermissions().then((p) => (p.receive === "granted" ? push.register() : undefined)).catch(() => undefined);
    push.removeAllDeliveredNotifications?.().catch(() => undefined);
    return () => {
      listeners.forEach((l) => l.then((x) => x.remove()).catch(() => undefined));
    };
  }, [router]);
  return null;
}
