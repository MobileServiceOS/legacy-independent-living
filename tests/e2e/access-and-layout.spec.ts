/** Authorization boundaries + mobile/desktop layout sanity (no horizontal scrolling). */
import { expect, test, type Page } from "@playwright/test";

const RESIDENT = { email: "angela.price@legacy.demo", password: "ResidentDemo2026!" };
const OTHER_RESIDENT = { email: "marcus.bell@legacy.demo", password: "ResidentDemo2026!" };
const ADMIN = { email: "owner@legacy.demo", password: "LegacyDemo2026!" };

async function login(page: Page, u: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password").fill(u.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Sign in and wait until the session cookie is set and we've left /login. */
async function signIn(page: Page, u: { email: string; password: string }) {
  await login(page, u);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function expectNoHorizontalScroll(page: Page) {
  // Page-level scroll AND any element poking past the right edge (scroll containers excepted).
  const overflow = await page.evaluate(() => {
    const vw = window.innerWidth;
    let worst = document.documentElement.scrollWidth - vw;
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("main *"))) {
      if (el.closest(".overflow-x-auto")) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0) worst = Math.max(worst, r.right - vw);
    }
    return worst;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

test("signed-out users are sent to sign in", async ({ page }) => {
  await page.goto("/admin/residents");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fresidents/);
  await page.goto("/home");
  await expect(page).toHaveURL(/\/login/);
});

test("wrong password shows a generic error", async ({ page }) => {
  await login(page, { email: RESIDENT.email, password: "nope-nope-nope1" });
  await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("resident sees only their own world", async ({ page }) => {
  await signIn(page, RESIDENT);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByText("Due soon").first()).toBeVisible();
  await expect(page.getByTestId("pay-rent")).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Admin area is off-limits
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/home$/);

  for (const path of ["/payments", "/documents", "/notifications", "/profile", "/maintenance", "/maintenance/new"]) {
    await page.goto(path);
    await expectNoHorizontalScroll(page);
  }
});

test("receipts are private to their resident", async ({ browser }) => {
  // Find one of Marcus's receipt URLs as Marcus…
  const marcus = await browser.newPage();
  await signIn(marcus, OTHER_RESIDENT);
  await marcus.goto("/payments");
  const href = await marcus.getByRole("link", { name: /Receipt/ }).first().getAttribute("href");
  expect(href).toMatch(/^\/receipts\//);
  await marcus.close();

  // …then try it as Angela.
  const angela = await browser.newPage();
  await signIn(angela, RESIDENT);
  const res = await angela.goto(href!);
  expect(res?.status()).toBe(404);
  await angela.close();
});

test("admin screens fit the viewport", async ({ page }) => {
  await signIn(page, ADMIN);
  for (const path of ["/admin", "/admin/properties", "/admin/residents", "/admin/applications", "/admin/payments", "/admin/reports", "/admin/settings", "/admin/maintenance"]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
});

test("PWA manifest and service worker are served", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  const json = await manifest.json();
  expect(json.display).toBe("standalone");
  expect(json.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBeTruthy();
  expect((await request.get("/sw.js")).ok()).toBeTruthy();
  expect((await request.get("/offline.html")).ok()).toBeTruthy();
});

test("cron endpoint requires the secret", async ({ request }) => {
  expect((await request.post("/api/cron/rent")).status()).toBe(401);
  const ok = await request.post("/api/cron/rent", { headers: { Authorization: "Bearer e2e-secret" } });
  expect(ok.ok()).toBeTruthy();
});
