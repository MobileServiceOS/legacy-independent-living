import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The app loads the live portal (so every web deploy updates the app instantly),
 * with native push notifications (APNs) and camera/photo access for repair photos.
 * PORTAL_URL lets you point a dev build at a staging server.
 */
const portal = new URL(process.env.PORTAL_URL ?? "https://portal.legacyindependentliving.net");

const config: CapacitorConfig = {
  appId: "net.legacyindependentliving.app",
  appName: "Legacy Living",
  webDir: "www",
  server: {
    url: portal.toString().replace(/\/$/, ""),
    cleartext: portal.protocol === "http:",
    // Keep PayPal checkout inside the app so the return URL comes back here.
    // Stripe Checkout + card 3-D Secure + bank linking stay in the app; Cash App Pay hands off to the Cash App.
    allowNavigation: [portal.host, "checkout.stripe.com", "*.stripe.com", "*.stripe.network", "*.paypal.com", "*.paypalobjects.com"],
    errorPath: "offline.html",
  },
  ios: {
    contentInset: "never",
    appendUserAgent: " LegacyLivingApp",
    backgroundColor: "#fbf8f1",
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
    // The web BootSplash component (src/components/boot-splash.tsx) hides this native
    // screen explicitly the instant it has painted, so the two hand off cleanly instead
    // of racing on independent timers (which could let this hide before or after the web
    // splash ever became visible). launchShowDuration here is only a failsafe in case the
    // webview never loads far enough to run that call.
    SplashScreen: { launchAutoHide: true, launchShowDuration: 3400, backgroundColor: "#fbf8f1", showSpinner: false },
  },
};

export default config;
