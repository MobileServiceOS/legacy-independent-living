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
    allowNavigation: [portal.host, "*.paypal.com", "*.paypalobjects.com"],
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
    SplashScreen: { launchAutoHide: true, launchShowDuration: 600, backgroundColor: "#fbf8f1", showSpinner: false },
  },
};

export default config;
