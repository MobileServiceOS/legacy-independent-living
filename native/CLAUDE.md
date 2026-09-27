# Task: build the Legacy Living iOS app (Capacitor) — run on the Mac in VS Code

The iOS app is a thin native shell around the live portal (`server.url` in `capacitor.config.ts`), plus native
**push notifications (APNs)** and camera access for repair photos. The web side of push is already done and tested:
the portal detects `window.Capacitor`, asks for permission, registers the APNs token at `POST /api/push/subscribe`,
and the server sends via APNs (`src/lib/push/apns.ts`). Your job is the native project, signing, and verification.

## Prerequisites (check, don't assume)
- macOS with Xcode 16+ (`xcodebuild -version`), Node 20+ (`node -v`), CocoaPods NOT required (Capacitor 7 uses SPM).
- Apple Developer account with the team the app will ship under.
- The portal deployed at a public HTTPS URL (default `https://portal.legacyindependentliving.net`). For a dev build against
  another server: `PORTAL_URL=https://staging.example.com npx cap sync ios`.

## Steps
1. `cd native && npm install`
2. `npm run ios:setup` — adds the iOS platform, generates icons/splash from `resources/`, patches AppDelegate/Info.plist/entitlements, syncs.
   Verify: `grep -n capacitorDidRegisterForRemoteNotifications ios/App/App/AppDelegate.swift` shows 2 lines.
3. `npm run ios:open` → in Xcode, target **App**:
   - Signing & Capabilities → Team = the Apple team; Bundle Identifier = `net.legacyindependentliving.app`.
   - **+ Capability → Push Notifications** (uses `App.entitlements`). Optional: Background Modes → Remote notifications.
   - General → Deployment target iOS 16.0; Device family iPhone + iPad; Display name “Legacy Living”.
4. Apple Developer portal → Keys → **+** → enable **Apple Push Notifications service (APNs)** → download `AuthKey_XXXXXXXXXX.p8`.
   Put these in the portal server's environment (NOT in this repo):
   ```
   APNS_KEY_ID=XXXXXXXXXX
   APNS_TEAM_ID=<10-char Team ID>
   APNS_BUNDLE_ID=net.legacyindependentliving.app
   APNS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
   APNS_ENV=sandbox        # Xcode/TestFlight-from-Xcode builds; use production for TestFlight/App Store
   ```
5. Run on a **real device** (push doesn't work in the Simulator for APNs tokens): select the phone → Run.

## Verify (all must pass before archiving)
- App launches to the portal login with the Legacy splash; status bar/notch don't cover the header (safe areas).
- Sign in as a resident → Profile → **Turn on notifications** → iOS permission prompt → allow.
  Server: a row appears in `push_subscriptions` with `kind='APNS'` for that user.
- From the owner portal (another device/browser) → Notifications → send an announcement → the phone gets a push
  within seconds. Tapping it opens the app on the right screen.
- Repairs → Report a problem → “Take or add photos” offers Camera and Photo Library.
- Pay rent → PayPal opens **inside the app** and returns to the receipt. If PayPal refuses to load inside the web view,
  report it — the fallback is opening checkout in `SFSafariViewController` via `@capacitor/browser` with a universal-link return.
- Sign out → the device stops receiving that resident's pushes (`push_subscriptions.disabled_at` set).

## Ship
- Product → Archive → Distribute → App Store Connect. Switch `APNS_ENV=production` on the server for TestFlight/App Store builds.
- Screenshots, listing copy, privacy answers and review notes: `../docs/store/APP_STORE.md` (sizes already exact).
- Privacy policy URL: `https://<portal>/privacy`. Account deletion: Profile → Delete my account (Guideline 5.1.1(v)).
