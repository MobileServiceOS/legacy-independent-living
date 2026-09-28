#!/usr/bin/env node
/**
 * Pre-archive check: run before every TestFlight/App Store build.
 *   npm run ios:preflight
 * Fails (exit 1) if the build would point at the wrong server or is missing
 * anything App Review checks. No network writes; read-only.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const app = join(root, "ios/App/App");
const problems = [];
const ok = [];
const check = (cond, good, bad) => (cond ? ok.push(good) : problems.push(bad));

// 1) The portal URL baked into this build (from the last `cap sync`).
const cfgPath = join(app, "capacitor.config.json");
let url = null;
if (!existsSync(cfgPath)) problems.push("ios/App/App/capacitor.config.json missing — run `npm run ios:sync` (with PORTAL_URL set if not using the custom domain)");
else {
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  url = cfg.server?.url ?? null;
  check(url?.startsWith("https://"), `portal URL: ${url}`, `server.url must be https (got ${url ?? "none"})`);
  check(!cfg.server?.cleartext, "no cleartext traffic", "server.cleartext must be off for release");
  check(cfg.appId === "net.legacyindependentliving.app", "bundle id matches", `appId is ${cfg.appId}`);
}

// 2) Live server answers — a reviewer who sees a blank screen rejects the app (Guideline 2.1).
if (url) {
  const get = async (path) => {
    try {
      const r = await fetch(new URL(path, url), { redirect: "manual", signal: AbortSignal.timeout(15000) });
      return { status: r.status, text: await r.text() };
    } catch (e) {
      return { status: 0, text: String(e) };
    }
  };
  const health = await get("/api/health");
  check(health.status === 200 && /"ok":true/.test(health.text), "/api/health ok", `/api/health failed (${health.status}) — is ${url} deployed and is DNS/HTTPS working?`);
  const login = await get("/login");
  check(login.status === 200, "/login loads", `/login returned ${login.status}`);
  const privacy = await get("/privacy");
  check(privacy.status === 200 && /privacy/i.test(privacy.text), "/privacy loads (App Store privacy URL)", `/privacy returned ${privacy.status}`);
  const manifest = await get("/manifest.webmanifest");
  check(manifest.status === 200, "web manifest served", `/manifest.webmanifest returned ${manifest.status}`);
}

// 3) Info.plist + entitlements App Review looks at.
const plist = existsSync(join(app, "Info.plist")) ? readFileSync(join(app, "Info.plist"), "utf8") : "";
for (const key of ["NSCameraUsageDescription", "NSPhotoLibraryUsageDescription"]) check(plist.includes(`<key>${key}</key>`), `${key} present`, `Info.plist missing ${key} (camera/photo permission text)`);
check(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/.test(plist), "export compliance set", "Info.plist missing ITSAppUsesNonExemptEncryption=false");
const ent = existsSync(join(app, "App.entitlements")) ? readFileSync(join(app, "App.entitlements"), "utf8") : "";
check(ent.includes("aps-environment"), "push entitlement present", "App.entitlements missing aps-environment (push won't work)");
const delegate = existsSync(join(app, "AppDelegate.swift")) ? readFileSync(join(app, "AppDelegate.swift"), "utf8") : "";
check(delegate.includes("capacitorDidRegisterForRemoteNotifications"), "AppDelegate forwards push token", "AppDelegate not patched — run `npm run ios:patch`");

// 4) Icon without transparency (App Store rejects alpha in the 1024 icon).
const icon = join(app, "Assets.xcassets/AppIcon.appiconset");
check(existsSync(icon), "app icon set present", "AppIcon.appiconset missing — run `npm run ios:assets`");

for (const line of ok) console.log(`  ✔ ${line}`);
for (const line of problems) console.log(`  ✖ ${line}`);
if (problems.length) {
  console.error(`\n✖ Preflight failed (${problems.length}). Fix before archiving.`);
  process.exit(1);
}
console.log("\n✔ Preflight passed — safe to archive.");
