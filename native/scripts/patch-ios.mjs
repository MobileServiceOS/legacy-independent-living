#!/usr/bin/env node
/**
 * Idempotently applies the iOS changes the portal needs after `cap add ios`:
 *  - AppDelegate: forward APNs registration to Capacitor's PushNotifications plugin
 *  - Info.plist: camera / photo library usage strings (repair photos), encryption export flag
 *  - App.entitlements: aps-environment (Push Notifications capability)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const app = join(import.meta.dirname, "..", "ios", "App", "App");
if (!existsSync(app)) {
  console.error("ios/App/App not found — run `npm run ios:add` first.");
  process.exit(1);
}

// 1) AppDelegate.swift
const delegatePath = join(app, "AppDelegate.swift");
let delegate = readFileSync(delegatePath, "utf8");
if (!delegate.includes("capacitorDidRegisterForRemoteNotifications")) {
  const methods = `
    // MARK: Push notifications → Capacitor PushNotifications plugin
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
`;
  const idx = delegate.lastIndexOf("}");
  delegate = delegate.slice(0, idx) + methods + delegate.slice(idx);
  writeFileSync(delegatePath, delegate);
  console.log("✔ AppDelegate.swift: push registration forwarding added");
} else console.log("• AppDelegate.swift already patched");

// 2) Info.plist
const plistPath = join(app, "Info.plist");
let plist = readFileSync(plistPath, "utf8");
const keys = {
  NSCameraUsageDescription: "Take photos of a repair problem so the office can see what needs fixing.",
  NSPhotoLibraryUsageDescription: "Attach photos of a repair problem from your library.",
};
for (const [k, v] of Object.entries(keys)) {
  if (!plist.includes(`<key>${k}</key>`)) plist = plist.replace(/<dict>/, `<dict>\n\t<key>${k}</key>\n\t<string>${v}</string>`);
}
if (!plist.includes("ITSAppUsesNonExemptEncryption")) plist = plist.replace(/<dict>/, "<dict>\n\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>");
writeFileSync(plistPath, plist);
console.log("✔ Info.plist: camera/photo usage strings + export compliance");

// 3) Entitlements (push). Xcode: also tick Signing & Capabilities → + Push Notifications.
const entPath = join(app, "App.entitlements");
if (!existsSync(entPath)) {
  writeFileSync(
    entPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>aps-environment</key>
\t<string>development</string>
</dict>
</plist>
`,
  );
  console.log("✔ App.entitlements created (aps-environment=development; Xcode switches to production for App Store builds)");
} else console.log("• App.entitlements exists");
console.log("\nNext: open Xcode (npm run ios:open) → App target → Signing & Capabilities → set Team, add 'Push Notifications' (links App.entitlements).");
