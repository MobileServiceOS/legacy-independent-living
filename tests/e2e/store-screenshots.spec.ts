/**
 * App Store + PWA screenshots at exact required pixel sizes.
 *   STORE_SCREENSHOTS=1 npx playwright test store-screenshots --project=desktop
 *
 * For each device we save:
 *   docs/store/<device>/raw/NN-name.png        exact-size app capture (uploadable as-is)
 *   docs/store/<device>/captioned/NN-name.png  branded marketing version (same size)
 * PWA install screenshots go to public/screenshots/ (referenced by the web manifest).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

test.skip(!process.env.STORE_SCREENSHOTS, "set STORE_SCREENSHOTS=1");
test.skip(({ isMobile }) => isMobile, "runs once; devices are emulated per shot");
test.setTimeout(600_000);

const ROOT = join(import.meta.dirname, "../..");
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

interface Device {
  id: string;
  label: string;
  width: number; // CSS px
  height: number;
  scale: number; // device pixel ratio → output = width*scale x height*scale
  mobile: boolean;
  ua?: string;
  frame: "phone" | "tablet" | "none";
}

const DEVICES: Record<string, Device> = {
  iphone69: { id: "iphone-6.9", label: 'iPhone 6.9" (1320×2868)', width: 440, height: 956, scale: 3, mobile: true, ua: IPHONE_UA, frame: "phone" },
  iphone65: { id: "iphone-6.5", label: 'iPhone 6.5" (1242×2688)', width: 414, height: 896, scale: 3, mobile: true, ua: IPHONE_UA, frame: "phone" },
  ipad13: { id: "ipad-13", label: 'iPad 13" (2064×2752)', width: 1032, height: 1376, scale: 2, mobile: true, ua: IPAD_UA, frame: "tablet" },
  pwaNarrow: { id: "pwa-narrow", label: "PWA narrow (1080×2340)", width: 360, height: 780, scale: 3, mobile: true, frame: "none" },
  pwaWide: { id: "pwa-wide", label: "PWA wide (1920×1080)", width: 1280, height: 720, scale: 1.5, mobile: false, frame: "none" },
};

const RESIDENT = { email: "angela.price@legacy.demo", password: "ResidentDemo2026!" };
const OWNER = { email: "owner@legacy.demo", password: "LegacyDemo2026!" };

interface Shot {
  name: string;
  who: "resident" | "owner";
  headline: string;
  sub: string;
  /** Navigate to the screen (page is already signed in). */
  go: (page: Page) => Promise<void>;
}

const goto = (path: string) => async (page: Page) => {
  await page.goto(path);
};

const RESIDENT_SHOTS: Shot[] = [
  { name: "home", who: "resident", headline: "Your rent, always clear", sub: "See your balance and due date the moment you open the app.", go: goto("/home") },
  { name: "pay", who: "resident", headline: "Pay rent in seconds", sub: "PayPal, bank, or card — on PayPal's secure checkout.", go: goto("/pay") },
  {
    name: "receipt",
    who: "resident",
    headline: "Instant receipts",
    sub: "Every payment documented, ready to print or save.",
    go: async (page) => {
      await page.goto("/payments");
      const href = await page.getByRole("link", { name: /Receipt/ }).first().getAttribute("href");
      await page.goto(href!);
    },
  },
  { name: "payments", who: "resident", headline: "Every payment in one place", sub: "Your full history and account activity, anytime.", go: goto("/payments") },
  { name: "report-repair", who: "resident", headline: "Report a repair from your phone", sub: "Snap a photo, pick how urgent — the office is notified right away.", go: goto("/maintenance/new") },
  {
    name: "repair-status",
    who: "resident",
    headline: "Know when help is coming",
    sub: "Follow every repair from request to done.",
    go: async (page) => {
      await page.goto("/maintenance");
      await page.getByRole("link", { name: /Bathroom sink is leaking/ }).click();
      await page.waitForURL(/\/maintenance\/[^/?]+$/);
    },
  },
];

const OWNER_SHOTS: Shot[] = [
  { name: "owner-dashboard", who: "owner", headline: "Every home at a glance", sub: "Occupancy, rent due, collected and overdue — live.", go: goto("/admin") },
  { name: "owner-properties", who: "owner", headline: "Every room, every resident", sub: "A visual occupancy board for each Legacy home.", go: goto("/admin/properties") },
  {
    name: "owner-resident",
    who: "owner",
    headline: "Complete resident records",
    sub: "Profile, housing, payments and an auditable ledger.",
    go: async (page) => {
      await page.goto("/admin/residents");
      await page.getByRole("link", { name: "Denise Carter" }).click();
      await page.waitForURL(/\/admin\/residents\/[^/?]+$/);
    },
  },
  { name: "owner-maintenance", who: "owner", headline: "Repairs, triaged and tracked", sub: "Urgent first. Schedule visits and keep residents updated.", go: goto("/admin/maintenance") },
  { name: "owner-reports", who: "owner", headline: "Reports that add up", sub: "Rent collection, occupancy and outstanding balances.", go: goto("/admin/reports") },
];

const PLAN: Array<{ device: Device; shots: Shot[] }> = [
  { device: DEVICES.iphone69!, shots: [...RESIDENT_SHOTS, OWNER_SHOTS[0]!] },
  { device: DEVICES.iphone65!, shots: [...RESIDENT_SHOTS, OWNER_SHOTS[0]!] },
  { device: DEVICES.ipad13!, shots: [...OWNER_SHOTS, RESIDENT_SHOTS[0]!, RESIDENT_SHOTS[4]!] },
  { device: DEVICES.pwaNarrow!, shots: [RESIDENT_SHOTS[0]!, RESIDENT_SHOTS[1]!, RESIDENT_SHOTS[5]!] },
  { device: DEVICES.pwaWide!, shots: [OWNER_SHOTS[0]!, OWNER_SHOTS[1]!, OWNER_SHOTS[3]!] },
];

/** Hide demo-only UI so screenshots look like the real product. */
const CLEAN_CSS = `[data-demo], [data-sandbox] { display: none !important; } nextjs-portal { display: none !important; }`;

async function signedInContext(browser: Browser, device: Device, who: { email: string; password: string }): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: device.scale,
    isMobile: device.mobile,
    hasTouch: device.mobile,
    userAgent: device.ua,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await page.close();
  return ctx;
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: CLEAN_CSS });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    await Promise.all(
      Array.from(document.images).map((img) => (img.complete ? null : new Promise((r) => img.addEventListener("load", r, { once: true })))),
    );
  });
  await page.waitForTimeout(250);
}

function fontFace(family: string, file: string, weight: number) {
  const b64 = readFileSync(join(ROOT, "src/app/fonts", file)).toString("base64");
  return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${b64}) format('woff2');font-weight:${weight};font-style:normal;}`;
}

const FONTS = [
  fontFace("Cormorant", "cormorantgaramond-600.woff2", 600),
  fontFace("Cormorant", "cormorantgaramond-700.woff2", 700),
  fontFace("Mulish", "mulish-600.woff2", 600),
  fontFace("Mulish", "mulish-800.woff2", 800),
].join("");

const LOGO = `data:image/webp;base64,${readFileSync(join(ROOT, "public/brand/logo-mark.webp")).toString("base64")}`;

/** Branded caption layout rendered at the exact output size. */
function captionHtml(shot: Shot, device: Device, png: Buffer, W: number, H: number): string {
  const tablet = device.frame === "tablet";
  const pad = Math.round(W * (tablet ? 0.07 : 0.08));
  const head = Math.round(W * (tablet ? 0.06 : 0.092));
  const sub = Math.round(W * (tablet ? 0.024 : 0.042));
  const shotW = Math.round(W * (tablet ? 0.8 : 0.8));
  const bezel = Math.round(W * (tablet ? 0.014 : 0.022));
  const radius = Math.round(W * (tablet ? 0.035 : 0.09));
  const top = Math.round(H * (tablet ? 0.22 : 0.25));
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}
    *{box-sizing:border-box;margin:0}
    html,body{width:${W}px;height:${H}px;overflow:hidden}
    body{background:radial-gradient(120% 70% at 50% 0%,#5b6840 0%,#3a431f 55%,#2e3518 100%);font-family:Mulish,sans-serif;color:#fbf8f1;position:relative}
    .brand{position:absolute;top:${Math.round(pad * 0.6)}px;left:0;right:0;display:flex;justify-content:center;align-items:center;gap:${Math.round(W * 0.015)}px}
    .brand img{width:${Math.round(W * (tablet ? 0.045 : 0.075))}px;height:auto;border-radius:50%;background:#fff}
    .brand span{font-family:Cormorant,serif;font-weight:600;font-size:${Math.round(sub * 1.05)}px;letter-spacing:.02em;color:#f5e8d5}
    .copy{position:absolute;top:${Math.round(pad * 0.6 + W * (tablet ? 0.07 : 0.12))}px;left:${pad}px;right:${pad}px;text-align:center}
    h1{font-family:Cormorant,serif;font-weight:700;font-size:${head}px;line-height:1.02;letter-spacing:-.01em;color:#fff;font-variant-numeric:lining-nums}
    p{margin-top:${Math.round(sub * 0.55)}px;font-weight:600;font-size:${sub}px;line-height:1.3;color:#e9e1cf}
    .device{position:absolute;left:50%;top:${top}px;width:${shotW + bezel * 2}px;transform:translateX(-50%);
      background:#171a0e;border-radius:${radius + bezel}px;padding:${bezel}px;box-shadow:0 ${Math.round(W * 0.03)}px ${Math.round(W * 0.08)}px rgba(0,0,0,.45)}
    .device img{display:block;width:100%;height:auto;border-radius:${radius}px}
  </style></head><body>
    <div class="brand"><img src="${LOGO}" alt=""><span>Legacy Independent Living</span></div>
    <div class="copy"><h1>${shot.headline}</h1><p>${shot.sub}</p></div>
    <div class="device"><img src="data:image/png;base64,${png.toString("base64")}" alt=""></div>
  </body></html>`;
}

test("store screenshots", async ({ browser }) => {
  const manifestShots: Array<{ src: string; sizes: string; type: string; form_factor: "narrow" | "wide"; label: string }> = [];
  const index: string[] = ["# Store screenshots", "", "Generated by `tests/e2e/store-screenshots.spec.ts`. Exact pixel sizes; no transparency.", ""];

  for (const { device, shots } of PLAN) {
    const W = Math.round(device.width * device.scale);
    const H = Math.round(device.height * device.scale);
    const dir = join(ROOT, "docs/store", device.id);
    mkdirSync(join(dir, "raw"), { recursive: true });
    if (device.frame !== "none") mkdirSync(join(dir, "captioned"), { recursive: true });
    index.push(`## ${device.label}`, "");

    const contexts: Partial<Record<"resident" | "owner", BrowserContext>> = {};
    let n = 0;
    for (const shot of shots) {
      n++;
      contexts[shot.who] ??= await signedInContext(browser, device, shot.who === "owner" ? OWNER : RESIDENT);
      const page = await contexts[shot.who]!.newPage();
      await shot.go(page);
      await expect(page.locator("main").first()).toBeVisible();
      await settle(page);
      const png = await page.screenshot({ type: "png", fullPage: false, animations: "disabled" });
      await page.close();
      const file = `${String(n).padStart(2, "0")}-${shot.name}.png`;
      writeFileSync(join(dir, "raw", file), png);

      if (device.frame === "none") {
        const factor = device.id === "pwa-wide" ? "wide" : "narrow";
        const pub = `pwa-${factor}-${String(n).padStart(2, "0")}-${shot.name}.png`;
        mkdirSync(join(ROOT, "public/screenshots"), { recursive: true });
        writeFileSync(join(ROOT, "public/screenshots", pub), png);
        manifestShots.push({ src: `/screenshots/${pub}`, sizes: `${W}x${H}`, type: "image/png", form_factor: factor, label: shot.headline });
        index.push(`- ${file} — ${shot.headline}`);
        continue;
      }

      const framer = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      await framer.setContent(captionHtml(shot, device, png, W, H), { waitUntil: "load" });
      await framer.evaluate(() => document.fonts.ready);
      await framer.screenshot({ path: join(dir, "captioned", file), type: "png" });
      await framer.close();
      index.push(`- ${file} — **${shot.headline}** · ${shot.sub}`);
    }
    for (const c of Object.values(contexts)) await c?.close();
    index.push("");
  }

  writeFileSync(join(ROOT, "src/app/manifest-screenshots.json"), JSON.stringify(manifestShots, null, 2) + "\n");
  writeFileSync(join(ROOT, "docs/store/INDEX.md"), index.join("\n"));
});
